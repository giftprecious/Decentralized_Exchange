# Stacks Decentralized Exchange (DEX)

A decentralized exchange (DEX) implementation for the Stacks blockchain using Clarity smart contracts.

## Overview

This DEX implementation provides a permissionless platform for trading SIP-010 compliant tokens on the Stacks blockchain. It uses an automated market maker (AMM) model with a constant product formula (x * y = k) similar to Uniswap v2.

## Features

- Create trading pairs between any two SIP-010 tokens
- Add and remove liquidity for token pairs
- Swap tokens with automatic price calculation
- Protocol fee mechanism (default 0.3%)
- Constant product market maker model

## Functions

### Pair Management

- `create-pair`: Create a new token trading pair
- `get-pair-data`: Get information about a specific token pair
- `get-price`: Get the current exchange rate between two tokens

### Liquidity Management

- `add-liquidity`: Add liquidity to a token pair
- `remove-liquidity`: Remove liquidity from a token pair
- `get-liquidity-provider-data`: Get information about a liquidity provider

### Trading Functions

- `swap-a-for-b`: Swap token A for token B
- `swap-b-for-a`: Swap token B for token A

### Admin Functions

- `set-protocol-fee-percent`: Change the protocol fee percentage (owner only)

## Error Codes

| Code | Description |
|------|-------------|
| u100 | Owner only operation |
| u101 | Not token owner |
| u102 | Zero liquidity |
| u103 | Insufficient balance |
| u104 | Zero amount |
| u105 | Slippage exceeded |
| u106 | Liquidity provider already exists |
| u107 | Not a liquidity provider |
| u108 | No liquidity in pool |
| u109 | Invalid token |
| u110 | Pair already exists |
| u111 | Pair not found |
| u112 | Cannot pair a token with itself |
| u113 | Fee exceeds maximum (10%) |

## Technical Details

### Constant Product Formula

The DEX uses the constant product formula (x * y = k) to determine token prices. This ensures that the product of the reserves always remains constant after trades (minus fees).

### Fee Structure

A protocol fee (default 0.3%) is applied to all trades. The fee is deducted from the input amount before calculating the trade output.

### Liquidity Provision

The first liquidity provider for a pair establishes the initial price ratio. Subsequent providers must supply tokens in the current ratio to avoid slippage.

## Example Usage

### Creating a Token Pair
```clarity
(contract-call? .dex create-pair .token-a .token-b)
```

### Adding Liquidity
```clarity
(contract-call? .dex add-liquidity .token-a .token-b u1000 u1000 u500)
```

### Swapping Tokens
```clarity
(contract-call? .dex swap-a-for-b .token-a .token-b u100 u90)
```

## Requirements

- Stacks blockchain
- SIP-010 compliant tokens

## Security Considerations

- Front-running protection is not implemented in this version
- No flash loan protection
- Users should be aware of potential slippage when trading


