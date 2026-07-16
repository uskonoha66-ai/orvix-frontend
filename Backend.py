from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from web3 import Web3
from web3.middleware import geth_poa_middleware
import os
import re
from decimal import Decimal
from typing import Dict, Any, List, Optional, Tuple
import json
import time

load_dotenv(".env")

app = Flask(__name__)

# CORS Configuration - Support all wallets
CORS(app, resources={
    r"/api/*": {
        "origins": "*",
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization", "X-Requested-With"],
        "expose_headers": ["Content-Type"],
        "supports_credentials": True
    }
})

# =============================================
# CONFIGURATION - EXACTLY AS IN ORIGINAL CLI
# =============================================
RPC_URL = os.environ.get("RPC_URL", "https://bsc-testnet.bnbchain.org")
ORVIX_AGGREGATOR = "0xA4Bf191D53B880cA49F1ceD0C0C840378bdDef42"
NATIVE = "0x0000000000000000000000000000000000000000"
WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd"
MAX_PRICE_IMPACT = 1000  # percent

# =============================================
# WEB3 SETUP - EXACTLY AS IN ORIGINAL CLI
# =============================================
w3 = Web3(Web3.HTTPProvider(RPC_URL))
w3.middleware_onion.inject(geth_poa_middleware, layer=0)

# Verify connection
if not w3.is_connected():
    print("❌ Failed to connect to BSC Testnet")
else:
    print(f"✅ Connected to BSC Testnet (Chain ID: {w3.eth.chain_id})")

# =============================================
# ABIs - EXACTLY AS IN ORIGINAL CLI
# =============================================
ERC20_ABI = [
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "owner", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "decimals", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint8"}]},
    {"name": "symbol", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "string"}]},
    {"name": "allowance", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "approve", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
]

WBNB_ABI = [
    {"name": "deposit", "type": "function", "stateMutability": "payable",
     "inputs": [], "outputs": []},
    {"name": "withdraw", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "amount", "type": "uint256"}], "outputs": []},
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "owner", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
]

ORVIX_ABI = [
    {"name": "quoteExactInput", "type": "function", "stateMutability": "view",
     "inputs": [
         {"name": "tokenIn", "type": "address"}, {"name": "tokenOut", "type": "address"},
         {"name": "amountIn", "type": "uint256"}, {"name": "factories", "type": "address[]"},
         {"name": "slippageBps", "type": "uint256"}
     ],
     "outputs": [{"name": "result", "type": "tuple", "components": [
         {"name": "hops", "type": "tuple[]", "components": [
             {"name": "pool", "type": "address"}, {"name": "tokenOut", "type": "address"},
             {"name": "v2FeeNumerator", "type": "uint16"}, {"name": "v2FeeDenominator", "type": "uint16"},
             {"name": "factory", "type": "address"}
         ]},
         {"name": "amountOut", "type": "uint256"}, {"name": "priceImpact", "type": "uint256"},
         {"name": "amountOutMin", "type": "uint256"}, {"name": "path", "type": "bytes"},
         {"name": "liquidityProfile", "type": "string"}, {"name": "poolLiquidity", "type": "uint256"},
         {"name": "bestPool", "type": "address"}
     ]}]},
    {"name": "swapExactInput", "type": "function", "stateMutability": "payable",
     "inputs": [
         {"name": "tokenIn", "type": "address"}, {"name": "tokenOut", "type": "address"},
         {"name": "amountIn", "type": "uint256"}, {"name": "amountOutMin", "type": "uint256"},
         {"name": "recipient", "type": "address"}, {"name": "deadline", "type": "uint256"},
         {"name": "path", "type": "bytes"}, {"name": "treasury", "type": "address"},
         {"name": "integrator", "type": "address"}
     ],
     "outputs": [{"name": "amountOut", "type": "uint256"}]},
    {"name": "assessPools", "type": "function", "stateMutability": "view",
     "inputs": [
         {"name": "tokenIn", "type": "address"}, {"name": "tokenOut", "type": "address"},
         {"name": "amountIn", "type": "uint256"}, {"name": "factories", "type": "address[]"},
         {"name": "rawMode", "type": "bool"}
     ],
     "outputs": [{"name": "assessments", "type": "tuple[]", "components": [
         {"name": "pool", "type": "address"},
         {"name": "output", "type": "uint256"},
         {"name": "liquidity", "type": "uint256"},
         {"name": "priceImpact", "type": "uint256"},
         {"name": "score", "type": "uint256"},
         {"name": "eligible", "type": "bool"},
         {"name": "failReason", "type": "uint256"}
     ]}]},
]

# =============================================
# CONTRACT INSTANCES - EXACTLY AS IN ORIGINAL CLI
# =============================================
orvix = w3.eth.contract(address=w3.to_checksum_address(ORVIX_AGGREGATOR), abi=ORVIX_ABI)
wbnb_contract = w3.eth.contract(address=w3.to_checksum_address(WBNB), abi=WBNB_ABI)

# =============================================
# HELPER FUNCTIONS - EXACTLY AS IN ORIGINAL CLI
# =============================================

def get_token_info(addr: str, user_address: str) -> Dict[str, Any]:
    """Get token info - IDENTICAL to CLI get_token_info()"""
    if addr == NATIVE:
        bal = w3.eth.get_balance(w3.to_checksum_address(user_address))
        return {"symbol": "BNB", "decimals": 18, "balance": bal, "address": NATIVE}
    c = w3.eth.contract(address=w3.to_checksum_address(addr), abi=ERC20_ABI)
    return {
        "symbol": c.functions.symbol().call(),
        "decimals": c.functions.decimals().call(),
        "balance": c.functions.balanceOf(w3.to_checksum_address(user_address)).call(),
        "address": addr,
    }

def get_token_balance(addr: str, user_address: str) -> int:
    """Get token balance - IDENTICAL to CLI get_token_balance()"""
    if addr == NATIVE:
        return w3.eth.get_balance(w3.to_checksum_address(user_address))
    c = w3.eth.contract(address=w3.to_checksum_address(addr), abi=ERC20_ABI)
    return c.functions.balanceOf(w3.to_checksum_address(user_address)).call()

def get_allowance(token_addr: str, user_address: str, spender_addr: str) -> int:
    """Get allowance - IDENTICAL to CLI get_allowance()"""
    if token_addr == NATIVE:
        return 0
    c = w3.eth.contract(address=w3.to_checksum_address(token_addr), abi=ERC20_ABI)
    return c.functions.allowance(
        w3.to_checksum_address(user_address),
        w3.to_checksum_address(spender_addr)
    ).call()

def decode_fail_reasons(failReason: int) -> List[str]:
    """Decode failReason flags - IDENTICAL to CLI"""
    reasons = []
    if failReason & 1: reasons.append("ZERO_RESERVE")
    if failReason & 2: reasons.append("ZERO_OUTPUT")
    if failReason & 4: reasons.append("ZERO_LIQUIDITY")
    if failReason & 8: reasons.append("PRICE_IMPACT")
    if failReason & 16: reasons.append("CIRCUIT_BREAKER")
    return reasons

def validate_address(address: str) -> bool:
    """Validate if address is a valid Ethereum address"""
    if address == NATIVE:
        return True
    try:
        w3.to_checksum_address(address)
        return True
    except:
        return False

# =============================================
# ENDPOINTS - 1:1 MAPPING OF CLI FUNCTIONS
# =============================================

@app.route('/api/network', methods=['GET'])
def api_network():
    """Get network information for wallet connection"""
    return jsonify({
        'chainId': w3.eth.chain_id,
        'chainName': 'BNB Smart Chain Testnet',
        'nativeCurrency': {
            'name': 'BNB',
            'symbol': 'BNB',
            'decimals': 18
        },
        'rpcUrls': [RPC_URL],
        'blockExplorerUrls': ['https://testnet.bscscan.com']
    })

@app.route('/api/token-info', methods=['POST'])
def api_token_info():
    """
    GET/POST token info:
    - symbol
    - decimals
    - balance
    IDENTICAL to CLI get_token_info()
    """
    data = request.json
    address = data.get('address', NATIVE)
    user_address = data.get('user_address')
    
    if not user_address:
        return jsonify({'error': 'user_address required'}), 400
    
    if not validate_address(address):
        return jsonify({'error': 'Invalid token address'}), 400
    
    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400
    
    try:
        info = get_token_info(address, user_address)
        return jsonify({
            'address': info['address'],
            'symbol': info['symbol'],
            'decimals': info['decimals'],
            'balance': str(info['balance'])
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/native-balance', methods=['POST'])
def api_native_balance():
    """
    Balance native BNB
    IDENTICAL to CLI w3.eth.get_balance()
    """
    data = request.json
    user_address = data.get('user_address')
    
    if not user_address:
        return jsonify({'error': 'user_address required'}), 400
    
    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400
    
    try:
        balance = w3.eth.get_balance(w3.to_checksum_address(user_address))
        return jsonify({
            'balance': str(balance),
            'formatted': str(balance / 10**18)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/wbnb-balance', methods=['POST'])
def api_wbnb_balance():
    """
    Balance WBNB
    IDENTICAL to CLI WBNB balance check
    """
    data = request.json
    user_address = data.get('user_address')
    
    if not user_address:
        return jsonify({'error': 'user_address required'}), 400
    
    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400
    
    try:
        balance = wbnb_contract.functions.balanceOf(w3.to_checksum_address(user_address)).call()
        return jsonify({
            'balance': str(balance),
            'formatted': str(balance / 10**18)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/allowance', methods=['POST'])
def api_allowance():
    """
    ERC20 allowance to aggregator
    IDENTICAL to CLI get_allowance()
    """
    data = request.json
    token_addr = data.get('token_address')
    user_address = data.get('user_address')
    spender_addr = data.get('spender_address', ORVIX_AGGREGATOR)
    
    if not token_addr or not user_address:
        return jsonify({'error': 'token_address and user_address required'}), 400
    
    if not validate_address(token_addr):
        return jsonify({'error': 'Invalid token address'}), 400
    
    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400
    
    try:
        allowance = get_allowance(token_addr, user_address, spender_addr)
        token_info = get_token_info(token_addr, user_address)
        return jsonify({
            'allowance': str(allowance),
            'formatted': str(allowance / (10 ** token_info['decimals'])) if token_info['decimals'] > 0 else '0',
            'spender': spender_addr,
            'token': token_addr
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/assess-pools', methods=['POST'])
def api_assess_pools():
    """
    Pool assessment:
    - call assessPools()
    - return all pools
    - preserve score sorting
    - preserve failReason decoding
    IDENTICAL to CLI assessPools() call + processing
    """
    data = request.json
    token_in = data.get('token_in')
    token_out = data.get('token_out')
    amount_in = data.get('amount_in')
    user_address = data.get('user_address')
    raw_mode = data.get('raw_mode', False)
    
    if not all([token_in, token_out, amount_in, user_address]):
        return jsonify({'error': 'Missing required parameters'}), 400
    
    if not validate_address(token_in) or not validate_address(token_out):
        return jsonify({'error': 'Invalid token address'}), 400
    
    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400
    
    try:
        amount_in = int(amount_in)
        
        # IDENTICAL to CLI: orvix.functions.assessPools(...).call()
        assessments = orvix.functions.assessPools(
            w3.to_checksum_address(token_in),
            w3.to_checksum_address(token_out),
            amount_in,
            [],
            raw_mode
        ).call({"from": w3.to_checksum_address(user_address)})
        
        # Get token info for formatting - IDENTICAL to CLI
        token_in_info = get_token_info(token_in, user_address)
        token_out_info = get_token_info(token_out, user_address)
        
        # Format assessments - IDENTICAL to CLI output
        formatted_assessments = []
        for assessment in assessments:
            pool, output, liquidity, impact, score, eligible, failReason = assessment
            
            formatted_assessments.append({
                'pool': pool,
                'output': str(output),
                'output_formatted': str(output / (10 ** token_out_info['decimals'])),
                'liquidity': str(liquidity),
                'liquidity_formatted': str(liquidity / 10**18),
                'price_impact': str(impact / 100),
                'price_impact_bps': str(impact),
                'score': str(score),
                'eligible': eligible,
                'fail_reasons': decode_fail_reasons(failReason),
                'fail_reason_code': failReason
            })
        
        # Sort by score descending - IDENTICAL to CLI
        formatted_assessments.sort(key=lambda x: int(x['score']), reverse=True)
        
        return jsonify({
            'token_in': {
                'address': token_in,
                'symbol': token_in_info['symbol'],
                'decimals': token_in_info['decimals']
            },
            'token_out': {
                'address': token_out,
                'symbol': token_out_info['symbol'],
                'decimals': token_out_info['decimals']
            },
            'amount_in': str(amount_in),
            'amount_in_formatted': str(amount_in / (10 ** token_in_info['decimals'])),
            'assessments': formatted_assessments,
            'total_pools': len(formatted_assessments)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/quote', methods=['POST'])
def api_quote():
    """
    Quote:
    - call quoteExactInput()
    - return:
      - hops
      - amountOut
      - amountOutMin
      - priceImpact
      - path
      - liquidityProfile
      - bestPool
    IDENTICAL to CLI quoteExactInput() call
    """
    data = request.json
    token_in = data.get('token_in')
    token_out = data.get('token_out')
    amount_in = data.get('amount_in')
    slippage_bps = data.get('slippage_bps', 50)
    user_address = data.get('user_address')
    
    if not all([token_in, token_out, amount_in, user_address]):
        return jsonify({'error': 'Missing required parameters'}), 400
    
    if not validate_address(token_in) or not validate_address(token_out):
        return jsonify({'error': 'Invalid token address'}), 400
    
    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400
    
    try:
        amount_in = int(amount_in)
        slippage_bps = int(slippage_bps)
        
        # IDENTICAL to CLI: orvix.functions.quoteExactInput(...).call()
        result = orvix.functions.quoteExactInput(
            w3.to_checksum_address(token_in),
            w3.to_checksum_address(token_out),
            amount_in,
            [],
            slippage_bps
        ).call({"from": w3.to_checksum_address(user_address)})
        
        token_in_info = get_token_info(token_in, user_address)
        token_out_info = get_token_info(token_out, user_address)
        
        # Result structure matches ABI exactly:
        # result[0] = hops, result[1] = amountOut, result[2] = priceImpact,
        # result[3] = amountOutMin, result[4] = path, result[5] = liquidityProfile,
        # result[6] = poolLiquidity, result[7] = bestPool
        
        return jsonify({
            'hops': [
                {
                    'pool': hop[0],
                    'token_out': hop[1],
                    'v2_fee_numerator': hop[2],
                    'v2_fee_denominator': hop[3],
                    'factory': hop[4]
                } for hop in result[0]
            ],
            'amount_out': str(result[1]),
            'amount_out_formatted': str(result[1] / (10 ** token_out_info['decimals'])),
            'price_impact': str(result[2] / 100),
            'price_impact_bps': str(result[2]),
            'amount_out_min': str(result[3]),
            'amount_out_min_formatted': str(result[3] / (10 ** token_out_info['decimals'])),
            'path': '0x' + result[4].hex() if isinstance(result[4], bytes) else result[4],
            'liquidity_profile': result[5],
            'pool_liquidity': str(result[6]),
            'best_pool': result[7]
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/build-swap', methods=['POST'])
def api_build_swap():
    """
    Transaction builder:
    Create unsigned transaction payload for swapExactInput()
    Returns: { to, data, value, gas }
    
    IDENTICAL to CLI swapExactInput() transaction building
    """
    data = request.json
    token_in = data.get('token_in')
    token_out = data.get('token_out')
    amount_in = data.get('amount_in')
    amount_out_min = data.get('amount_out_min')
    recipient = data.get('recipient')
    path = data.get('path')
    treasury = data.get('treasury')
    integrator = data.get('integrator')
    deadline = data.get('deadline', int(time.time()) + 3600)  # 1 hour from now
    user_address = data.get('user_address')
    
    if not all([token_in, token_out, amount_in, amount_out_min, recipient, path, user_address]):
        return jsonify({'error': 'Missing required parameters'}), 400
    
    if not validate_address(token_in) or not validate_address(token_out):
        return jsonify({'error': 'Invalid token address'}), 400
    
    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400
    
    try:
        # Convert path from hex string to bytes if needed
        if isinstance(path, str) and path.startswith('0x'):
            path_bytes = bytes.fromhex(path[2:])
        elif isinstance(path, str):
            path_bytes = path.encode()
        else:
            path_bytes = path
        
        # IDENTICAL to CLI transaction building
        tx = orvix.functions.swapExactInput(
            w3.to_checksum_address(token_in),
            w3.to_checksum_address(token_out),
            int(amount_in),
            int(amount_out_min),
            w3.to_checksum_address(recipient),
            int(deadline),
            path_bytes,
            w3.to_checksum_address(treasury if treasury else recipient),
            w3.to_checksum_address(integrator if integrator else recipient)
        ).build_transaction({
            "from": w3.to_checksum_address(user_address),
            "nonce": None,  # Frontend will set
            "gas": 500000,  # Frontend will estimate
            "gasPrice": None,  # Frontend will set
            "value": int(amount_in) if token_in == NATIVE else 0,
        })
        
        return jsonify({
            'to': tx['to'],
            'data': '0x' + tx['data'].hex(),
            'value': str(tx['value']),
            'gas': str(tx['gas']),
            'chainId': w3.eth.chain_id
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/build-wrap', methods=['POST'])
def api_build_wrap():
    """
    Transaction builder:
    Create unsigned transaction payload for WBNB deposit()
    Returns: { to, data, value, gas }
    
    IDENTICAL to CLI WBNB deposit() transaction building
    """
    data = request.json
    amount = data.get('amount')
    user_address = data.get('user_address')
    
    if not amount or not user_address:
        return jsonify({'error': 'Missing required parameters'}), 400
    
    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400
    
    try:
        # IDENTICAL to CLI deposit() transaction building
        tx = wbnb_contract.functions.deposit().build_transaction({
            "from": w3.to_checksum_address(user_address),
            "nonce": None,  # Frontend will set
            "gas": 200000,  # Frontend will estimate
            "gasPrice": None,  # Frontend will set
            "value": int(amount),
        })
        
        return jsonify({
            'to': tx['to'],
            'data': '0x' + tx['data'].hex(),
            'value': str(tx['value']),
            'gas': str(tx['gas']),
            'chainId': w3.eth.chain_id
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/build-unwrap', methods=['POST'])
def api_build_unwrap():
    """
    Transaction builder:
    Create unsigned transaction payload for WBNB withdraw()
    Returns: { to, data, value, gas }
    
    IDENTICAL to CLI WBNB withdraw() transaction building
    """
    data = request.json
    amount = data.get('amount')
    user_address = data.get('user_address')
    
    if not amount or not user_address:
        return jsonify({'error': 'Missing required parameters'}), 400
    
    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400
    
    try:
        # IDENTICAL to CLI withdraw() transaction building
        tx = wbnb_contract.functions.withdraw(int(amount)).build_transaction({
            "from": w3.to_checksum_address(user_address),
            "nonce": None,  # Frontend will set
            "gas": 200000,  # Frontend will estimate
            "gasPrice": None,  # Frontend will set
            "value": 0,
        })
        
        return jsonify({
            'to': tx['to'],
            'data': '0x' + tx['data'].hex(),
            'value': str(tx['value']),
            'gas': str(tx['gas']),
            'chainId': w3.eth.chain_id
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/build-approve', methods=['POST'])
def api_build_approve():
    """
    Transaction builder:
    Create unsigned transaction payload for ERC20 approve()
    Returns: { to, data, value, gas }
    
    Note: Frontend will handle signing and sending
    """
    data = request.json
    token_address = data.get('token_address')
    spender_address = data.get('spender_address', ORVIX_AGGREGATOR)
    amount = data.get('amount', 2**256 - 1)  # Default to max
    user_address = data.get('user_address')
    
    if not token_address or not user_address:
        return jsonify({'error': 'token_address and user_address required'}), 400
    
    if not validate_address(token_address):
        return jsonify({'error': 'Invalid token address'}), 400
    
    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400
    
    try:
        token = w3.eth.contract(address=w3.to_checksum_address(token_address), abi=ERC20_ABI)
        
        tx = token.functions.approve(
            w3.to_checksum_address(spender_address),
            int(amount)
        ).build_transaction({
            "from": w3.to_checksum_address(user_address),
            "nonce": None,  # Frontend will set
            "gas": 100000,  # Frontend will estimate
            "gasPrice": None,  # Frontend will set
            "value": 0,
        })
        
        return jsonify({
            'to': tx['to'],
            'data': '0x' + tx['data'].hex(),
            'value': str(tx['value']),
            'gas': str(tx['gas']),
            'chainId': w3.eth.chain_id
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/estimate-gas', methods=['POST'])
def api_estimate_gas():
    """
    Estimate gas for a transaction
    """
    data = request.json
    to = data.get('to')
    data_hex = data.get('data')
    value = data.get('value', '0')
    from_address = data.get('from')
    
    if not all([to, data_hex, from_address]):
        return jsonify({'error': 'Missing required parameters'}), 400
    
    try:
        tx = {
            'to': w3.to_checksum_address(to),
            'data': data_hex,
            'value': int(value),
            'from': w3.to_checksum_address(from_address)
        }
        
        gas_estimate = w3.eth.estimate_gas(tx)
        gas_price = w3.eth.gas_price
        
        return jsonify({
            'gas_estimate': str(gas_estimate),
            'gas_price': str(gas_price),
            'gas_cost': str(gas_estimate * gas_price),
            'gas_cost_bnb': str((gas_estimate * gas_price) / 10**18)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'network': 'BSC Testnet',
        'chainId': w3.eth.chain_id,
        'aggregator': ORVIX_AGGREGATOR,
        'wbnb': WBNB,
        'rpc': RPC_URL,
        'connected': w3.is_connected()
    })

@app.route('/api/contract-addresses', methods=['GET'])
def contract_addresses():
    """Get all contract addresses used by the system"""
    return jsonify({
        'orvix_aggregator': ORVIX_AGGREGATOR,
        'wbnb': WBNB,
        'native': NATIVE,
        'chainId': w3.eth.chain_id
    })

# =============================================
# ERROR HANDLING
# =============================================

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': 'Internal server error'}), 500

# CORS preflight handling
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    return response

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
