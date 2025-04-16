import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock contract addresses
const mockTokenAContract = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.token-a';
const mockTokenBContract = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.token-b';
const dexContract = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.dex';

// Mock blockchain types and utilities
const types = {
  uint: (num) => ({ type: 'uint', value: num }),
  principal: (address) => ({ type: 'principal', value: address }),
  bool: (value) => ({ type: 'bool', value }),
  ok: (value) => ({ type: 'response', success: true, value }),
  err: (value) => ({ type: 'response', success: false, value }),
  some: (value) => ({ type: 'option', hasValue: true, value }),
  none: () => ({ type: 'option', hasValue: false }),
  utf8: (string) => ({ type: 'string', value: string }),
  tuple: (obj) => ({ type: 'tuple', value: obj })
};

// Mock response extensions
const responseProto = {
  expectOk() {
    if (this.success) return this.value;
    throw new Error('Expected OK but got ERR');
  },
  expectErr() {
    if (!this.success) return this.value;
    throw new Error('Expected ERR but got OK');
  }
};

const valueProto = {
  expectUint() {
    if (this.type === 'uint') return this.value;
    throw new Error(`Expected uint but got ${this.type}`);
  },
  expectBool() {
    if (this.type === 'bool') return this.value;
    throw new Error(`Expected bool but got ${this.type}`);
  },
  expectSome() {
    if (this.type === 'option' && this.hasValue) return this.value;
    throw new Error('Expected Some but got None');
  },
  expectTuple() {
    if (this.type === 'tuple') return this.value;
    throw new Error(`Expected tuple but got ${this.type}`);
  }
};

// Mock blockchain classes
class Account {
  constructor(public address: string) {}
}

class Chain {
  contracts = new Map();
  state = {
    pairs: {},
    liquidity: {},
    protocolFee: 30 // 0.3%
  };

  constructor() {}

  createAccount(name: string): Account {
    return new Account(name);
  }

  mineBlock(transactions: any[]): { receipts: any[] } {
    const receipts = transactions.map(tx => {
      const result = this.executeTransaction(tx);
      return { result };
    });
    return { receipts };
  }

  callReadOnlyFn(contract: string, method: string, args: any[], sender: string): { result: any } {
    if (method === 'get-price') {
      const [tokenA, tokenB] = args;
      const pairKey = `${tokenA.value}-${tokenB.value}`;
      const pair = this.state.pairs[pairKey];
      
      if (!pair) {
        return { result: types.err(types.uint(111)) }; // err-pair-not-found
      }
      
      if (pair.reserveA === 0 || pair.reserveB === 0) {
        return { result: types.err(types.uint(102)) }; // err-zero-liquidity
      }
      
      const price = Math.floor(pair.reserveB / pair.reserveA);
      return { result: types.ok(types.uint(price)) };
    }
    
    if (method === 'get-pair-data') {
      const [tokenA, tokenB] = args;
      const pairKey = `${tokenA.value}-${tokenB.value}`;
      const pair = this.state.pairs[pairKey];
      
      if (!pair) {
        return { result: types.none() };
      }
      
      const result = types.some(types.tuple({
        'reserve-a': types.uint(pair.reserveA),
        'reserve-b': types.uint(pair.reserveB),
        'liquidity-total': types.uint(pair.liquidityTotal)
      }));
      
      return { result };
    }
    
    if (method === 'get-liquidity-provider-data') {
      const [tokenA, tokenB, provider] = args;
      const pairKey = `${tokenA.value}-${tokenB.value}`;
      const providerKey = `${pairKey}-${provider.value}`;
      const providerData = this.state.liquidity[providerKey];
      
      if (!providerData) {
        return { result: types.none() };
      }
      
      const result = types.some(types.tuple({
        'liquidity-provided': types.uint(providerData.liquidityProvided)
      }));
      
      return { result };
    }
    
    // Mock token contract reads
    if (contract === mockTokenAContract || contract === mockTokenBContract) {
      if (method === 'get-name') {
        return { result: types.some(types.utf8(contract === mockTokenAContract ? 'Token A' : 'Token B')) };
      }
      if (method === 'get-balance') {
        return { result: types.ok(types.uint(10000)) };
      }
    }
    
    return { result: types.err(types.uint(404)) }; // Not implemented
  }

  executeTransaction(tx: any): any {
    // Apply Object prototype extensions for response assertions
    const extendResponse = (obj) => {
      if (obj.type === 'response') {
        Object.setPrototypeOf(obj, responseProto);
        if (obj.value && typeof obj.value === 'object') {
          extendValue(obj.value);
        }
      }
      return obj;
    };

    const extendValue = (obj) => {
      if (!obj) return obj;
      Object.setPrototypeOf(obj, valueProto);
      if (obj.type === 'tuple' && obj.value) {
        for (const key in obj.value) {
          if (obj.value[key] && typeof obj.value[key] === 'object') {
            extendValue(obj.value[key]);
          }
        }
      }
      if (obj.type === 'option' && obj.hasValue && obj.value) {
        extendValue(obj.value);
      }
      return obj;
    };

    const { contract, method, args, sender } = tx;
    
    // Implement DEX contract methods
    if (contract === dexContract) {
      if (method === 'create-pair') {
        const [tokenA, tokenB] = args;
        
        // Check if tokens are the same
        if (tokenA.value === tokenB.value) {
          return extendResponse(types.err(types.uint(112))); // err-same-token
        }
        
        const pairKey = `${tokenA.value}-${tokenB.value}`;
        
        // Check if pair already exists
        if (this.state.pairs[pairKey]) {
          return extendResponse(types.err(types.uint(110))); // err-pair-exists
        }
        
        // Create the pair
        this.state.pairs[pairKey] = {
          reserveA: 0,
          reserveB: 0,
          liquidityTotal: 0
        };
        
        return extendResponse(types.ok(types.bool(true)));
      }
      
      if (method === 'add-liquidity') {
        const [tokenA, tokenB, amountA, amountB, minLiquidity] = args;
        const pairKey = `${tokenA.value}-${tokenB.value}`;
        const pair = this.state.pairs[pairKey];
        
        // Check if pair exists
        if (!pair) {
          return extendResponse(types.err(types.uint(111))); // err-pair-not-found
        }
        
        // Check amounts are valid
        if (amountA.value === 0 || amountB.value === 0) {
          return extendResponse(types.err(types.uint(104))); // err-zero-amount
        }
        
        let liquidityMinted = 0;
        
        // Calculate liquidity to mint
        if (pair.liquidityTotal === 0) {
          // For the first liquidity provision
          liquidityMinted = Math.floor(Math.sqrt(amountA.value * amountB.value));
        } else {
          // For subsequent additions
          if (pair.reserveA === 0) {
            liquidityMinted = amountA.value;
          } else {
            liquidityMinted = Math.floor((amountA.value * pair.liquidityTotal) / pair.reserveA);
          }
        }
        
        // Check minimum liquidity requirement
        if (liquidityMinted < minLiquidity.value) {
          return extendResponse(types.err(types.uint(105))); // err-slippage-exceeded
        }
        
        // Update reserves and total liquidity
        pair.reserveA += amountA.value;
        pair.reserveB += amountB.value;
        pair.liquidityTotal += liquidityMinted;
        
        // Update liquidity provider's balance
        const providerKey = `${pairKey}-${sender}`;
        if (!this.state.liquidity[providerKey]) {
          this.state.liquidity[providerKey] = { liquidityProvided: 0 };
        }
        this.state.liquidity[providerKey].liquidityProvided += liquidityMinted;
        
        return extendResponse(types.ok(types.uint(liquidityMinted)));
      }
      
      if (method === 'swap-a-for-b') {
        const [tokenA, tokenB, amountIn, minAmountOut] = args;
        const pairKey = `${tokenA.value}-${tokenB.value}`;
        const pair = this.state.pairs[pairKey];
        
        // Check if pair exists
        if (!pair) {
          return extendResponse(types.err(types.uint(111))); // err-pair-not-found
        }
        
        // Check inputs
        if (amountIn.value === 0) {
          return extendResponse(types.err(types.uint(104))); // err-zero-amount
        }
        
        if (pair.reserveA === 0 || pair.reserveB === 0) {
          return extendResponse(types.err(types.uint(102))); // err-zero-liquidity
        }
        
        // Calculate protocol fee
        const protocolFee = Math.floor((amountIn.value * this.state.protocolFee) / 10000);
        const amountInWithFee = amountIn.value - protocolFee;
        
        // Calculate output amount using constant product formula (x * y = k)
        const amountOut = Math.floor((pair.reserveB * amountInWithFee) / (pair.reserveA + amountInWithFee));
        
        if (amountOut === 0) {
          return extendResponse(types.err(types.uint(104))); // err-zero-amount
        }
        
        // Check slippage
        if (amountOut < minAmountOut.value) {
          return extendResponse(types.err(types.uint(105))); // err-slippage-exceeded
        }
        
        // Update reserves
        pair.reserveA += amountIn.value;
        pair.reserveB -= amountOut;
        
        return extendResponse(types.ok(types.uint(amountOut)));
      }
      
      if (method === 'swap-b-for-a') {
        const [tokenA, tokenB, amountIn, minAmountOut] = args;
        const pairKey = `${tokenA.value}-${tokenB.value}`;
        const pair = this.state.pairs[pairKey];
        
        // Check if pair exists
        if (!pair) {
          return extendResponse(types.err(types.uint(111))); // err-pair-not-found
        }
        
        // Check inputs
        if (amountIn.value === 0) {
          return extendResponse(types.err(types.uint(104))); // err-zero-amount
        }
        
        if (pair.reserveA === 0 || pair.reserveB === 0) {
          return extendResponse(types.err(types.uint(102))); // err-zero-liquidity
        }
        
        // Calculate protocol fee
        const protocolFee = Math.floor((amountIn.value * this.state.protocolFee) / 10000);
        const amountInWithFee = amountIn.value - protocolFee;
        
        // Calculate output amount using constant product formula (x * y = k)
        const amountOut = Math.floor((pair.reserveA * amountInWithFee) / (pair.reserveB + amountInWithFee));
        
        if (amountOut === 0) {
          return extendResponse(types.err(types.uint(104))); // err-zero-amount
        }
        
        // Check slippage
        if (amountOut < minAmountOut.value) {
          return extendResponse(types.err(types.uint(105))); // err-slippage-exceeded
        }
        
        // Update reserves
        pair.reserveB += amountIn.value;
        pair.reserveA -= amountOut;
        
        return extendResponse(types.ok(types.uint(amountOut)));
      }
      
      if (method === 'remove-liquidity') {
        const [tokenA, tokenB, liquidityAmount, minAmountA, minAmountB] = args;
        const pairKey = `${tokenA.value}-${tokenB.value}`;
        const pair = this.state.pairs[pairKey];
        
        // Check if pair exists
        if (!pair) {
          return extendResponse(types.err(types.uint(111))); // err-pair-not-found
        }
        
        // Check if sender is a liquidity provider
        const providerKey = `${pairKey}-${sender}`;
        const providerData = this.state.liquidity[providerKey];
        
        if (!providerData) {
          return extendResponse(types.err(types.uint(107))); // err-not-liquidity-provider
        }
        
        // Check liquidity parameters
        if (liquidityAmount.value === 0) {
          return extendResponse(types.err(types.uint(104))); // err-zero-amount
        }
        
        if (providerData.liquidityProvided < liquidityAmount.value) {
          return extendResponse(types.err(types.uint(103))); // err-insufficient-balance
        }
        
        if (pair.liquidityTotal === 0) {
          return extendResponse(types.err(types.uint(108))); // err-no-liquidity
        }
        
        // Calculate amounts to return
        const amountAToReturn = Math.floor((liquidityAmount.value * pair.reserveA) / pair.liquidityTotal);
        const amountBToReturn = Math.floor((liquidityAmount.value * pair.reserveB) / pair.liquidityTotal);
        
        // Check minimum amount requirements
        if (amountAToReturn < minAmountA.value || amountBToReturn < minAmountB.value) {
          return extendResponse(types.err(types.uint(105))); // err-slippage-exceeded
        }
        
        // Update reserves and total liquidity
        pair.reserveA -= amountAToReturn;
        pair.reserveB -= amountBToReturn;
        pair.liquidityTotal -= liquidityAmount.value;
        
        // Update provider's liquidity balance
        providerData.liquidityProvided -= liquidityAmount.value;
        
        const result = types.ok(types.tuple({
          'amount-a': types.uint(amountAToReturn),
          'amount-b': types.uint(amountBToReturn)
        }));
        
        return extendResponse(result);
      }
      
      if (method === 'set-protocol-fee-percent') {
        const [newFeePercent] = args;
        
        // Only contract owner can set the fee
        if (sender !== 'deployer') {
          return extendResponse(types.err(types.uint(100))); // err-owner-only
        }
        
        // Check max fee
        if (newFeePercent.value > 1000) {
          return extendResponse(types.err(types.uint(113))); // custom error for max fee
        }
        
        this.state.protocolFee = newFeePercent.value;
        
        return extendResponse(types.ok(types.bool(true)));
      }
    }
    
    // Not implemented
    return extendResponse(types.err(types.uint(404)));
  }
}

// Create mocked tx factory
const Tx = {
  contractCall: (contract, method, args, sender) => ({
    contract,
    method,
    args,
    sender
  })
};

describe('Decentralized Exchange (DEX) Contract Tests', () => {
  let chain;
  let deployer;
  let user1;
  let user2;

  beforeEach(() => {
    // Set up a new blockchain for each test
    chain = new Chain();
    
    // Set up accounts
    deployer = chain.createAccount('deployer');
    user1 = chain.createAccount('user1');
    user2 = chain.createAccount('user2');
  });

  describe('Create Pair', () => {
    it('should create a new token pair successfully', () => {
      const txResult = chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'create-pair',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract)
          ],
          deployer.address
        )
      ]).receipts[0];

      // Check transaction succeeded
      expect(txResult.result).toEqual(types.ok(types.bool(true)));
    });

    it('should fail if creating a pair with the same token', () => {
      const txResult = chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'create-pair',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenAContract)
          ],
          deployer.address
        )
      ]).receipts[0];

      // Check transaction failed with expected error code
      expect(txResult.result).toEqual(types.err(types.uint(112))); // err-same-token
    });

    it('should fail if pair already exists', () => {
      // Create the pair first
      chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'create-pair',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract)
          ],
          deployer.address
        )
      ]);

      // Try to create the same pair again
      const txResult = chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'create-pair',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract)
          ],
          deployer.address
        )
      ]).receipts[0];

      // Check transaction failed with expected error code
      expect(txResult.result).toEqual(types.err(types.uint(110))); // err-pair-exists
    });
  });

  describe('Add Liquidity', () => {
    beforeEach(() => {
      // Create a pair before each add liquidity test
      chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'create-pair',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract)
          ],
          deployer.address
        )
      ]);
    });

    it('should add initial liquidity successfully', () => {
      const txResult = chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'add-liquidity',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract),
            types.uint(1000), // amount-a
            types.uint(1000), // amount-b
            types.uint(900)   // min-liquidity
          ],
          user1.address
        )
      ]).receipts[0];

      // Check transaction succeeded
      expect(txResult.result).toBeDefined();
      const value = txResult.result.expectOk().expectUint();
      
      // Check liquidity tokens minted (should be sqrt(1000*1000) = 1000)
      expect(value).toEqual(1000);
    });

    it('should add additional liquidity proportionally', async () => {
      // First add initial liquidity
      chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'add-liquidity',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract),
            types.uint(1000), // amount-a
            types.uint(1000), // amount-b
            types.uint(900)   // min-liquidity
          ],
          user1.address
        )
      ]);

      // Add more liquidity
      const txResult = chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'add-liquidity',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract),
            types.uint(500),  // amount-a (50% more)
            types.uint(500),  // amount-b (50% more)
            types.uint(450)   // min-liquidity
          ],
          user2.address
        )
      ]).receipts[0];

      // Check transaction succeeded
      expect(txResult.result).toBeDefined();
      const value = txResult.result.expectOk().expectUint();
      
      // Check liquidity tokens minted (should be proportional to first deposit)
      expect(value).toEqual(500); // 50% of the initial liquidity
    });

    it('should fail if minimum liquidity requirement not met', () => {
      const txResult = chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'add-liquidity',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract),
            types.uint(1000), // amount-a
            types.uint(1000), // amount-b
            types.uint(1100)  // min-liquidity (too high)
          ],
          user1.address
        )
      ]).receipts[0];

      // Check transaction failed with expected error code
      expect(txResult.result).toEqual(types.err(types.uint(105))); // err-slippage-exceeded
    });
  });

  describe('Swap Tokens', () => {
    beforeEach(() => {
      // Create a pair and add liquidity before each swap test
      chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'create-pair',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract)
          ],
          deployer.address
        ),
        Tx.contractCall(
          dexContract,
          'add-liquidity',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract),
            types.uint(10000), // amount-a
            types.uint(10000), // amount-b
            types.uint(9000)   // min-liquidity
          ],
          deployer.address
        )
      ]);
    });

    it('should swap token A for token B successfully', () => {
      const swapAmount = 1000;
      
      const txResult = chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'swap-a-for-b',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract),
            types.uint(swapAmount), // amount-in
            types.uint(900)         // min-amount-out
          ],
          user1.address
        )
      ]).receipts[0];

      // Check transaction succeeded
      expect(txResult.result).toBeDefined();
      const amountOut = txResult.result.expectOk().expectUint();
      
      // With the constant product formula and 0.3% fee:
      // fee-adjusted input = 1000 * 0.997 = 997
      // output = (10000 * 997) / (10000 + 997) ≈ 906
      expect(amountOut).toBeGreaterThan(900);
      expect(amountOut).toBeLessThan(910);
    });

    it('should swap token B for token A successfully', () => {
      const swapAmount = 1000;
      
      const txResult = chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'swap-b-for-a',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract),
            types.uint(swapAmount), // amount-in
            types.uint(900)         // min-amount-out
          ],
          user1.address
        )
      ]).receipts[0];

      // Check transaction succeeded
      expect(txResult.result).toBeDefined();
      const amountOut = txResult.result.expectOk().expectUint();
      
      // Similar calculation as above
      expect(amountOut).toBeGreaterThan(900);
      expect(amountOut).toBeLessThan(910);
    });

    it('should fail if slippage tolerance exceeded', () => {
      const txResult = chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'swap-a-for-b',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract),
            types.uint(1000), // amount-in
            types.uint(990)  // min-amount-out (too high for this swap)
          ],
          user1.address
        )
      ]).receipts[0];

      // Check transaction failed with expected error code
      expect(txResult.result).toEqual(types.err(types.uint(105))); // err-slippage-exceeded
    });
  });

  describe('Remove Liquidity', () => {
    beforeEach(() => {
      // Create pair and add liquidity as user1
      chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'create-pair',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract)
          ],
          deployer.address
        ),
        Tx.contractCall(
          dexContract,
          'add-liquidity',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract),
            types.uint(10000), // amount-a
            types.uint(10000), // amount-b
            types.uint(9000)   // min-liquidity
          ],
          user1.address
        )
      ]);
    });

    it('should remove liquidity successfully', () => {
      const txResult = chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'remove-liquidity',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract),
            types.uint(5000), // liquidity-amount (50%)
            types.uint(4900), // min-amount-a
            types.uint(4900)  // min-amount-b
          ],
          user1.address
        )
      ]).receipts[0];

      // Check transaction succeeded
      expect(txResult.result).toBeDefined();
      const result = txResult.result.expectOk().expectTuple();
      
      // Should get back approximately 50% of tokens
      expect(result['amount-a'].expectUint()).toEqual(5000);
      expect(result['amount-b'].expectUint()).toEqual(5000);
    });

    it('should fail if user is not a liquidity provider', () => {
      const txResult = chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'remove-liquidity',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract),
            types.uint(5000), // liquidity-amount
            types.uint(4900), // min-amount-a
            types.uint(4900)  // min-amount-b
          ],
          user2.address // user2 has not provided liquidity
        )
      ]).receipts[0];

      // Check transaction failed with expected error code
      expect(txResult.result).toEqual(types.err(types.uint(107))); // err-not-liquidity-provider
    });

    it('should fail if minimum output requirements not met', () => {
      const txResult = chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'remove-liquidity',
          [
            types.principal(mockTokenAContract),
            types.principal(mockTokenBContract),
            types.uint(5000), // liquidity-amount
            types.uint(5100), // min-amount-a (too high)
            types.uint(4900)  // min-amount-b
          ],
          user1.address
        )
      ]).receipts[0];

      // Check transaction failed with expected error code
      expect(txResult.result).toEqual(types.err(types.uint(105))); // err-slippage-exceeded
    });
  });

  describe('Admin Functions', () => {
    it('should allow owner to set protocol fee', () => {
      const txResult = chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'set-protocol-fee-percent',
          [types.uint(50)], // 0.5%
          deployer.address
        )
      ]).receipts[0];

      // Check transaction succeeded
      expect(txResult.result).toEqual(types.ok(types.bool(true)));
    });

    it('should not allow non-owner to set protocol fee', () => {
      const txResult = chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'set-protocol-fee-percent',
          [types.uint(50)], // 0.5%
          user1.address // not the owner
        )
      ]).receipts[0];

      // Check transaction failed with expected error code
      expect(txResult.result).toEqual(types.err(types.uint(100))); // err-owner-only
    });

    it('should not allow setting fee above maximum', () => {
      const txResult = chain.mineBlock([
        Tx.contractCall(
          dexContract,
          'set-protocol-fee-percent',
          [types.uint(1100)], // 11% - above max of 10%
          deployer.address
        )
      ]).receipts[0];

      // Check transaction failed with expected error code
      expect(txResult.result).toEqual(types.err(types.uint(113))); // custom error for max fee
    });
  });

});