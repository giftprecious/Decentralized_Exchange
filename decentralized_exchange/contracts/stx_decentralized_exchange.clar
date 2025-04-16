
;; title: Decentralized Exchange (DEX) for the Stacks blockchain
;; version:
;; summary:
;; description:



;; Traits
(define-trait sip-010-trait
  (
    ;; Transfer from the caller to a new principal
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
    
    ;; Get the token balance of the specified principal
    (get-balance (principal) (response uint uint))
    
    ;; Get the total supply of the token
    (get-total-supply () (response uint uint))
    
    ;; Get the token name
    (get-name () (response (string-ascii 32) uint))
    
    ;; Get the token symbol
    (get-symbol () (response (string-ascii 32) uint))
    
    ;; Get the token decimals
    (get-decimals () (response uint uint))
    
    ;; Get the URI for token metadata
    (get-token-uri () (response (optional (string-utf8 256)) uint))
  )
)


;; Define constants
(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-not-token-owner (err u101))
(define-constant err-zero-liquidity (err u102))
(define-constant err-insufficient-balance (err u103))
(define-constant err-zero-amount (err u104))
(define-constant err-slippage-exceeded (err u105))
(define-constant err-liquidity-provider-exists (err u106))
(define-constant err-not-liquidity-provider (err u107))
(define-constant err-no-liquidity (err u108))
(define-constant err-invalid-token (err u109))
(define-constant err-pair-exists (err u110))
(define-constant err-pair-not-found (err u111))
(define-constant err-same-token (err u112))

;; Define data variables
(define-data-var protocol-fee-percent uint u30) ;; 0.3% fee by default

;; Define data maps
(define-map pairs 
  { token-a: principal, token-b: principal } 
  { 
    reserve-a: uint, 
    reserve-b: uint,
    liquidity-total: uint
  }
)


(define-map liquidity-providers
  { token-a: principal, token-b: principal, provider: principal }
  { liquidity-provided: uint }
)

;; Create a token pair
(define-public (create-pair (token-a-contract <sip-010-trait>) (token-b-contract <sip-010-trait>))
  (let
    (
      (token-a (contract-of token-a-contract))
      (token-b (contract-of token-b-contract))
    )
    (begin
      ;; Check tokens are different
      (asserts! (not (is-eq token-a token-b)) err-same-token)
      
      ;; Make sure token-a is lexicographically smaller than token-b for consistent ordering
      (if (> (unwrap-panic (contract-call? token-a-contract get-name)) 
             (unwrap-panic (contract-call? token-b-contract get-name)))
        (create-pair-helper token-b-contract token-a-contract)
        (create-pair-helper token-a-contract token-b-contract)
      )
    )
  )
)

;; Helper function to ensure pairs are always stored with the same ordering
(define-private (create-pair-helper (token-a-contract <sip-010-trait>) (token-b-contract <sip-010-trait>))
  (let
    (
      (token-a (contract-of token-a-contract))
      (token-b (contract-of token-b-contract))
      (pair-exists (map-get? pairs { token-a: token-a, token-b: token-b }))
    )
    (begin
      ;; Check if pair already exists
      (asserts! (not pair-exists) err-pair-exists)
      
      ;; Create the pair with zero reserves
      (map-set pairs 
        { token-a: token-a, token-b: token-b }
        { reserve-a: u0, reserve-b: u0, liquidity-total: u0 }
      )
      
      (ok true)
    )
  )
)


;; Add liquidity to a pair
(define-public (add-liquidity 
  (token-a-contract <sip-010-trait>) 
  (token-b-contract <sip-010-trait>) 
  (amount-a uint) 
  (amount-b uint)
  (min-liquidity uint))
  (let
    (
      (token-a (contract-of token-a-contract))
      (token-b (contract-of token-b-contract))
      (pair-data (unwrap! (map-get? pairs { token-a: token-a, token-b: token-b }) err-pair-not-found))
      (reserve-a (get reserve-a pair-data))
      (reserve-b (get reserve-b pair-data))
      (liquidity-total (get liquidity-total pair-data))
      (liquidity-minted uint)
      (is-initial-liquidity (is-eq liquidity-total u0))
    )
    (begin
      ;; Check amounts are valid
      (asserts! (> amount-a u0) err-zero-amount)
      (asserts! (> amount-b u0) err-zero-amount)
      
      ;; Transfer tokens to the contract
      (try! (contract-call? token-a-contract transfer amount-a tx-sender (as-contract tx-sender) none))
      (try! (contract-call? token-b-contract transfer amount-b tx-sender (as-contract tx-sender) none))
      
      ;; Calculate liquidity to mint
      (if is-initial-liquidity
        ;; For the first liquidity provision, liquidity tokens = sqrt(amount-a * amount-b)
        (set liquidity-minted (sqrt (* amount-a amount-b)))
        ;; For subsequent additions, maintain the price ratio
        (if (is-eq reserve-a u0) 
          (set liquidity-minted amount-a)
          (set liquidity-minted (/ (* amount-a liquidity-total) reserve-a))
        )
      )
      
      ;; Check minimum liquidity requirement
      (asserts! (>= liquidity-minted min-liquidity) err-slippage-exceeded)
      
      ;; Update reserves and total liquidity
      (map-set pairs 
        { token-a: token-a, token-b: token-b }
        { 
          reserve-a: (+ reserve-a amount-a), 
          reserve-b: (+ reserve-b amount-b), 
          liquidity-total: (+ liquidity-total liquidity-minted)
        }
      )
      
      ;; Update liquidity provider's balance
      (map-set liquidity-providers
        { token-a: token-a, token-b: token-b, provider: tx-sender }
        { 
          liquidity-provided: (+ 
            (default-to u0 
              (get liquidity-provided 
                (map-get? liquidity-providers { token-a: token-a, token-b: token-b, provider: tx-sender })
              )
            ) 
            liquidity-minted
          )
        }
      )
      
      (ok liquidity-minted)
    )
  )
)

;; Remove liquidity from a pair
(define-public (remove-liquidity 
  (token-a-contract <sip-010-trait>) 
  (token-b-contract <sip-010-trait>) 
  (liquidity-amount uint)
  (min-amount-a uint)
  (min-amount-b uint))
  (let
    (
      (token-a (contract-of token-a-contract))
      (token-b (contract-of token-b-contract))
      (pair-data (unwrap! (map-get? pairs { token-a: token-a, token-b: token-b }) err-pair-not-found))
      (reserve-a (get reserve-a pair-data))
      (reserve-b (get reserve-b pair-data))
      (liquidity-total (get liquidity-total pair-data))
      (provider-data (unwrap! (map-get? liquidity-providers { token-a: token-a, token-b: token-b, provider: tx-sender }) err-not-liquidity-provider))
      (provider-liquidity (get liquidity-provided provider-data))
      (amount-a-to-return (/ (* liquidity-amount reserve-a) liquidity-total))
      (amount-b-to-return (/ (* liquidity-amount reserve-b) liquidity-total))
    )
    (begin
      ;; Check liquidity parameters
      (asserts! (> liquidity-amount u0) err-zero-amount)
      (asserts! (>= provider-liquidity liquidity-amount) err-insufficient-balance)
      (asserts! (> liquidity-total u0) err-no-liquidity)
      
      ;; Check minimum amount requirements
      (asserts! (>= amount-a-to-return min-amount-a) err-slippage-exceeded)
      (asserts! (>= amount-b-to-return min-amount-b) err-slippage-exceeded)
      
      ;; Update reserves and total liquidity
      (map-set pairs 
        { token-a: token-a, token-b: token-b }
        { 
          reserve-a: (- reserve-a amount-a-to-return), 
          reserve-b: (- reserve-b amount-b-to-return), 
          liquidity-total: (- liquidity-total liquidity-amount)
        }
      )
      
      ;; Update provider's liquidity balance
      (map-set liquidity-providers
        { token-a: token-a, token-b: token-b, provider: tx-sender }
        { liquidity-provided: (- provider-liquidity liquidity-amount) }
      )
      
      ;; Transfer tokens back to the provider
      (as-contract (contract-call? token-a-contract transfer amount-a-to-return tx-sender tx-sender none))
      (as-contract (contract-call? token-b-contract transfer amount-b-to-return tx-sender tx-sender none))
      
      (ok { amount-a: amount-a-to-return, amount-b: amount-b-to-return })
    )
  )
)

;; Swap function: token-a for token-b
(define-public (swap-a-for-b 
  (token-a-contract <sip-010-trait>) 
  (token-b-contract <sip-010-trait>) 
  (amount-in uint)
  (min-amount-out uint))
  (let
    (
      (token-a (contract-of token-a-contract))
      (token-b (contract-of token-b-contract))
      (pair-data (unwrap! (map-get? pairs { token-a: token-a, token-b: token-b }) err-pair-not-found))
      (reserve-a (get reserve-a pair-data))
      (reserve-b (get reserve-b pair-data))
      (protocol-fee (/ (* amount-in (var-get protocol-fee-percent)) u10000))
      (amount-in-with-fee (- amount-in protocol-fee))
      (amount-out (get-output-amount amount-in-with-fee reserve-a reserve-b))
      (new-reserve-a (+ reserve-a amount-in))
      (new-reserve-b (- reserve-b amount-out))
    )
    (begin
      ;; Check inputs
      (asserts! (> amount-in u0) err-zero-amount)
      (asserts! (> reserve-a u0) err-zero-liquidity)
      (asserts! (> reserve-b u0) err-zero-liquidity)
      (asserts! (>= amount-out min-amount-out) err-slippage-exceeded)
      (asserts! (> amount-out u0) err-zero-amount)
      
      ;; Transfer token-a from sender to contract
      (try! (contract-call? token-a-contract transfer amount-in tx-sender (as-contract tx-sender) none))
      
      ;; Transfer token-b from contract to sender
      (as-contract (try! (contract-call? token-b-contract transfer amount-out tx-sender tx-sender none)))
      
      ;; Update reserves
      (map-set pairs 
        { token-a: token-a, token-b: token-b }
        { 
          reserve-a: new-reserve-a, 
          reserve-b: new-reserve-b, 
          liquidity-total: (get liquidity-total pair-data)
        }
      )
      
      (ok amount-out)
    )
  )
)

