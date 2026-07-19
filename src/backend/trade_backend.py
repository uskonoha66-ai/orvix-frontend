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

# Path encoding constants — MUST match OrvixAggregator.sol exactly
# Format: [ROUTE_VERSION_V1(1B)][hopCount(1B)][pool(20B)][tokenOut(20B)][feeNum(2B)][feeDen(2B)][factory(20B)] x N
ROUTE_VERSION_V1 = 0x01
DEFAULT_FEE_NUMERATOR = 9975
DEFAULT_FEE_DENOMINATOR = 10000

# =============================================
# WEB3 SETUP - NOW SUPPORTS PER-REQUEST CUSTOM RPC
# =============================================
# Default RPC tetap dipakai sebagai fallback dan untuk endpoint yang tidak
# mengirim rpc_url (mis. saat startup / health check).
w3 = Web3(Web3.HTTPProvider(RPC_URL))
w3.middleware_onion.inject(geth_poa_middleware, layer=0)

# Cache instance Web3 per RPC URL supaya tidak bikin instance baru tiap
# request kalau user berulang kali pakai RPC yang sama (hemat overhead).
_w3_cache: Dict[str, Web3] = {RPC_URL: w3}


def get_w3(custom_rpc: Optional[str] = None) -> Tuple[Web3, str, bool, Optional[str]]:
    """
    Return (w3_instance, rpc_used, used_fallback, fallback_reason).

    Kalau custom_rpc diberikan, coba pakai itu dulu. Kalau custom_rpc gagal
    connect (invalid URL, timeout, RPC down, dll), otomatis fallback ke
    RPC_URL default — supaya request tetap ada kemungkinan berhasil daripada
    langsung error total ke user.

    used_fallback = True kalau custom_rpc diminta TAPI gagal dan akhirnya
    pakai default. fallback_reason berisi pesan error asli (mis. timeout,
    connection refused, dll) — dikembalikan ke frontend/curl langsung
    supaya tidak perlu cek log server terpisah untuk tahu kenapa fallback
    terjadi.
    """
    if not custom_rpc:
        return w3, RPC_URL, False, None

    if custom_rpc in _w3_cache:
        cached = _w3_cache[custom_rpc]
        try:
            if cached.is_connected():
                return cached, custom_rpc, False, None
        except Exception:
            pass  # cached instance bermasalah, coba bikin ulang di bawah

    try:
        custom_w3 = Web3(Web3.HTTPProvider(custom_rpc, request_kwargs={"timeout": 8}))
        custom_w3.middleware_onion.inject(geth_poa_middleware, layer=0)
        if not custom_w3.is_connected():
            raise ConnectionError(f"Custom RPC not reachable: {custom_rpc}")
        _w3_cache[custom_rpc] = custom_w3
        return custom_w3, custom_rpc, False, None
    except Exception as e:
        reason = f"{type(e).__name__}: {e}"
        print(f"⚠️  Custom RPC failed ({custom_rpc}): {reason}. Falling back to default.")
        return w3, RPC_URL, True, reason


def get_contracts(w3_instance: Web3) -> Tuple[Any, Any]:
    """Return (orvix_contract, wbnb_contract) bound to the given Web3 instance."""
    orvix_c = w3_instance.eth.contract(address=w3_instance.to_checksum_address(ORVIX_AGGREGATOR), abi=ORVIX_ABI)
    wbnb_c = w3_instance.eth.contract(address=w3_instance.to_checksum_address(WBNB), abi=WBNB_ABI)
    return orvix_c, wbnb_c

# Verify default connection at startup
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
    {"name": "getAllWhitelistedFactories", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "factories", "type": "address[]"}]},
    {"name": "getFactoryFee", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "factory", "type": "address"}],
     "outputs": [{"name": "feeNumerator", "type": "uint16"}, {"name": "feeDenominator", "type": "uint16"}]},
]

# Minimal UniswapV2-style factory ABI — used to reverse-lookup which factory
# produced a given pool address, so we can build the swap path manually
# without ever calling quoteExactInput (per product decision: user picks
# any pool from assessPools() directly, not just the auto-selected best one).
FACTORY_ABI = [
    {"name": "getPair", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "tokenA", "type": "address"}, {"name": "tokenB", "type": "address"}],
     "outputs": [{"name": "pair", "type": "address"}]},
]

# =============================================
# DEFAULT CONTRACT INSTANCES (bound to default RPC)
# =============================================
orvix, wbnb_contract = get_contracts(w3)

# =============================================
# HELPER FUNCTIONS - EXACTLY AS IN ORIGINAL CLI
# =============================================

def get_token_info(addr: str, user_address: str, w3_instance: Web3 = None) -> Dict[str, Any]:
    """Get token info - now accepts w3_instance for custom RPC support"""
    w3i = w3_instance or w3
    if addr == NATIVE:
        bal = w3i.eth.get_balance(w3i.to_checksum_address(user_address))
        return {"symbol": "BNB", "decimals": 18, "balance": bal, "address": NATIVE}
    c = w3i.eth.contract(address=w3i.to_checksum_address(addr), abi=ERC20_ABI)
    return {
        "symbol": c.functions.symbol().call(),
        "decimals": c.functions.decimals().call(),
        "balance": c.functions.balanceOf(w3i.to_checksum_address(user_address)).call(),
        "address": addr,
    }

def get_token_balance(addr: str, user_address: str, w3_instance: Web3 = None) -> int:
    """Get token balance - now accepts w3_instance for custom RPC support"""
    w3i = w3_instance or w3
    if addr == NATIVE:
        return w3i.eth.get_balance(w3i.to_checksum_address(user_address))
    c = w3i.eth.contract(address=w3i.to_checksum_address(addr), abi=ERC20_ABI)
    return c.functions.balanceOf(w3i.to_checksum_address(user_address)).call()

def get_allowance(token_addr: str, user_address: str, spender_addr: str, w3_instance: Web3 = None) -> int:
    """Get allowance - now accepts w3_instance for custom RPC support"""
    w3i = w3_instance or w3
    if token_addr == NATIVE:
        return 0
    c = w3i.eth.contract(address=w3i.to_checksum_address(token_addr), abi=ERC20_ABI)
    return c.functions.allowance(
        w3i.to_checksum_address(user_address),
        w3i.to_checksum_address(spender_addr)
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


def tx_data_to_hex(tx_data) -> str:
    """
    FIX: web3.py v6+ already returns build_transaction()['data'] as a hex
    string (e.g. '0x1234...'), not bytes like older versions. Calling
    .hex() on an already-string value crashes with
    "'str' object has no attribute 'hex'". This helper handles both cases
    safely regardless of which web3.py version is installed.
    """
    if isinstance(tx_data, (bytes, bytearray)):
        return '0x' + tx_data.hex()
    if isinstance(tx_data, str):
        return tx_data if tx_data.startswith('0x') else '0x' + tx_data
    return '0x' + bytes(tx_data).hex()


def encode_path(pool: str, token_out: str, fee_numerator: int, fee_denominator: int, factory: str) -> str:
    """
    Encode a single-hop route path — IDENTICAL to OrvixAggregator.sol _encodePath()
    for a 1-hop route.

    Format: [ROUTE_VERSION_V1(1B)][hopCount(1B)][pool(20B)][tokenOut(20B)]
            [feeNum(2B)][feeDen(2B)][factory(20B)]

    Only supports 1-hop (direct pool) paths — sufficient for Orvix's current
    product flow where the user picks one pool directly from assessPools(),
    rather than a multi-hop route via quoteExactInput().
    """
    pool_bytes = bytes.fromhex(w3.to_checksum_address(pool)[2:])
    token_out_bytes = bytes.fromhex(w3.to_checksum_address(token_out)[2:])
    factory_bytes = bytes.fromhex(w3.to_checksum_address(factory)[2:])

    packed = (
        bytes([ROUTE_VERSION_V1]) +
        bytes([1]) +  # hopCount = 1 (direct swap, single pool)
        pool_bytes +
        token_out_bytes +
        fee_numerator.to_bytes(2, byteorder="big") +
        fee_denominator.to_bytes(2, byteorder="big") +
        factory_bytes
    )
    return "0x" + packed.hex()


def find_factory_for_pool(w3_instance: Web3, orvix_contract, token_in: str, token_out: str, pool_address: str) -> Optional[str]:
    """
    Reverse-lookup which whitelisted factory produced the given pool address,
    by calling getPair(tokenIn, tokenOut) on each whitelisted factory and
    matching against pool_address. This mirrors exactly what assessPools()
    does internally (_getPairFromFactory), just run from the backend so we
    can build a path without calling quoteExactInput().
    """
    t_in = w3_instance.to_checksum_address(token_in) if token_in != NATIVE else w3_instance.to_checksum_address(WBNB)
    t_out = w3_instance.to_checksum_address(token_out) if token_out != NATIVE else w3_instance.to_checksum_address(WBNB)
    target_pool = w3_instance.to_checksum_address(pool_address)

    factories = orvix_contract.functions.getAllWhitelistedFactories().call()
    for factory in factories:
        try:
            factory_contract = w3_instance.eth.contract(
                address=w3_instance.to_checksum_address(factory), abi=FACTORY_ABI
            )
            pair = factory_contract.functions.getPair(t_in, t_out).call()
            if w3_instance.to_checksum_address(pair) == target_pool:
                return factory
        except Exception:
            continue  # factory might not implement getPair identically, skip
    return None

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
    rpc_url = data.get('rpc_url')  # FIX: custom RPC dari Settings power user

    if not user_address:
        return jsonify({'error': 'user_address required'}), 400

    if not validate_address(address):
        return jsonify({'error': 'Invalid token address'}), 400

    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400

    try:
        w3i, rpc_used, used_fallback, fallback_reason = get_w3(rpc_url)
        info = get_token_info(address, user_address, w3i)
        return jsonify({
            'address': info['address'],
            'symbol': info['symbol'],
            'decimals': info['decimals'],
            'balance': str(info['balance']),
            'rpc_used': rpc_used,
            'used_fallback': used_fallback,
            'fallback_reason': fallback_reason
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
    rpc_url = data.get('rpc_url')

    if not user_address:
        return jsonify({'error': 'user_address required'}), 400

    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400

    try:
        w3i, rpc_used, used_fallback, fallback_reason = get_w3(rpc_url)
        balance = w3i.eth.get_balance(w3i.to_checksum_address(user_address))
        return jsonify({
            'balance': str(balance),
            'formatted': str(balance / 10**18),
            'rpc_used': rpc_used,
            'used_fallback': used_fallback,
            'fallback_reason': fallback_reason
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
    rpc_url = data.get('rpc_url')

    if not user_address:
        return jsonify({'error': 'user_address required'}), 400

    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400

    try:
        w3i, rpc_used, used_fallback, fallback_reason = get_w3(rpc_url)
        _, wbnb_c = get_contracts(w3i)
        balance = wbnb_c.functions.balanceOf(w3i.to_checksum_address(user_address)).call()
        return jsonify({
            'balance': str(balance),
            'formatted': str(balance / 10**18),
            'rpc_used': rpc_used,
            'used_fallback': used_fallback,
            'fallback_reason': fallback_reason
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
    rpc_url = data.get('rpc_url')

    if not token_addr or not user_address:
        return jsonify({'error': 'token_address and user_address required'}), 400

    if not validate_address(token_addr):
        return jsonify({'error': 'Invalid token address'}), 400

    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400

    try:
        w3i, rpc_used, used_fallback, fallback_reason = get_w3(rpc_url)
        allowance = get_allowance(token_addr, user_address, spender_addr, w3i)
        token_info = get_token_info(token_addr, user_address, w3i)
        return jsonify({
            'allowance': str(allowance),
            'formatted': str(allowance / (10 ** token_info['decimals'])) if token_info['decimals'] > 0 else '0',
            'spender': spender_addr,
            'token': token_addr,
            'rpc_used': rpc_used,
            'used_fallback': used_fallback,
            'fallback_reason': fallback_reason
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
    rpc_url = data.get('rpc_url')

    if not all([token_in, token_out, amount_in, user_address]):
        return jsonify({'error': 'Missing required parameters'}), 400

    if not validate_address(token_in) or not validate_address(token_out):
        return jsonify({'error': 'Invalid token address'}), 400

    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400

    try:
        amount_in = int(amount_in)
        w3i, rpc_used, used_fallback, fallback_reason = get_w3(rpc_url)
        orvix_c, _ = get_contracts(w3i)

        # IDENTICAL to CLI: orvix.functions.assessPools(...).call()
        assessments = orvix_c.functions.assessPools(
            w3i.to_checksum_address(token_in),
            w3i.to_checksum_address(token_out),
            amount_in,
            [],
            raw_mode
        ).call({"from": w3i.to_checksum_address(user_address)})

        # Get token info for formatting - IDENTICAL to CLI
        token_in_info = get_token_info(token_in, user_address, w3i)
        token_out_info = get_token_info(token_out, user_address, w3i)

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
            'total_pools': len(formatted_assessments),
            'rpc_used': rpc_used,
            'used_fallback': used_fallback,
            'fallback_reason': fallback_reason
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

    FIX: sekarang menerima optional 'pool_address' di body request.
    Kalau 'pool_address' dikirim, quote akan dipaksa memakai pool spesifik
    itu (dengan mengisi parameter on-chain 'factories' = [pool_address]),
    sehingga path yang dikembalikan PASTI sesuai pool yang dipilih user di
    frontend (bukan auto-pick best pool). Kalau 'pool_address' tidak
    dikirim, behavior lama tetap jalan (factories = [], auto-pick).
    """
    data = request.json
    token_in = data.get('token_in')
    token_out = data.get('token_out')
    amount_in = data.get('amount_in')
    slippage_bps = data.get('slippage_bps', 50)
    user_address = data.get('user_address')
    pool_address = data.get('pool_address')  # pool spesifik pilihan user (opsional)
    rpc_url = data.get('rpc_url')  # FIX: custom RPC dari Settings power user

    if not all([token_in, token_out, amount_in, user_address]):
        return jsonify({'error': 'Missing required parameters'}), 400

    if not validate_address(token_in) or not validate_address(token_out):
        return jsonify({'error': 'Invalid token address'}), 400

    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400

    if pool_address and not validate_address(pool_address):
        return jsonify({'error': 'Invalid pool address'}), 400

    try:
        amount_in = int(amount_in)
        slippage_bps = int(slippage_bps)
        w3i, rpc_used, used_fallback, fallback_reason = get_w3(rpc_url)
        orvix_c, _ = get_contracts(w3i)

        # kalau pool_address ada, filter quoteExactInput ke pool itu saja,
        # supaya 'path' yang di-return match persis dengan pool yang diklik
        # user di Pool Assessment, bukan pool lain yang auto-terpilih.
        factories = [w3i.to_checksum_address(pool_address)] if pool_address else []

        # IDENTICAL to CLI: orvix.functions.quoteExactInput(...).call()
        result = orvix_c.functions.quoteExactInput(
            w3i.to_checksum_address(token_in),
            w3i.to_checksum_address(token_out),
            amount_in,
            factories,
            slippage_bps
        ).call({"from": w3i.to_checksum_address(user_address)})

        token_in_info = get_token_info(token_in, user_address, w3i)
        token_out_info = get_token_info(token_out, user_address, w3i)

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
            'best_pool': result[7],
            'rpc_used': rpc_used,
            'used_fallback': used_fallback,
            'fallback_reason': fallback_reason
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/build-path-for-pool', methods=['POST'])
def api_build_path_for_pool():
    """
    Build a swap path for a SPECIFIC pool the user picked from assessPools()
    results — WITHOUT calling quoteExactInput() at all.

    Why this exists: Orvix lets the user pick ANY pool from the Pool
    Assessment list (not just the best-scored one), as an educational/
    transparency feature. quoteExactInput() always auto-selects the best
    pool internally, so it can't be used to build a path for a
    user-chosen non-best pool. Instead, we replicate the contract's own
    path-encoding logic here in Python:

      1. Reverse-lookup which whitelisted factory produced this pool
         (by calling factory.getPair(tokenIn, tokenOut) on each
         whitelisted factory until one matches — same as the contract's
         internal _getPairFromFactory).
      2. Fetch that factory's fee (getFactoryFee), falling back to
         DEFAULT_FEE_NUMERATOR/DENOMINATOR if unset — same fallback the
         contract itself uses in _buildHop.
      3. Encode a 1-hop path with the exact same byte layout as the
         contract's _encodePath(), so swapExactInput() decodes it
         correctly on-chain.

    amount_out_min is computed here from the pool's 'output' value
    (already returned by /api/assess-pools) minus slippage — no extra
    on-chain call needed for that either.
    """
    data = request.json
    token_in = data.get('token_in')
    token_out = data.get('token_out')
    pool_address = data.get('pool_address')
    pool_output = data.get('pool_output')  # 'output' field from assess-pools response for this pool
    slippage_bps = data.get('slippage_bps', 50)
    rpc_url = data.get('rpc_url')

    if not all([token_in, token_out, pool_address, pool_output]):
        return jsonify({'error': 'Missing required parameters: token_in, token_out, pool_address, pool_output'}), 400

    if not validate_address(token_in) or not validate_address(token_out):
        return jsonify({'error': 'Invalid token address'}), 400

    if not validate_address(pool_address):
        return jsonify({'error': 'Invalid pool address'}), 400

    try:
        slippage_bps = int(slippage_bps)
        if slippage_bps < 0 or slippage_bps > 10000:
            return jsonify({'error': 'slippage_bps must be between 0 and 10000'}), 400

        pool_output = int(pool_output)
        w3i, rpc_used, used_fallback, fallback_reason = get_w3(rpc_url)
        orvix_c, _ = get_contracts(w3i)

        factory = find_factory_for_pool(w3i, orvix_c, token_in, token_out, pool_address)
        if not factory:
            return jsonify({'error': f'Could not find a whitelisted factory for pool {pool_address}. It may not be a valid Orvix pool.'}), 400

        fee_num, fee_den = orvix_c.functions.getFactoryFee(w3i.to_checksum_address(factory)).call()
        if fee_num == 0:
            fee_num = DEFAULT_FEE_NUMERATOR
        if fee_den == 0:
            fee_den = DEFAULT_FEE_DENOMINATOR

        # tokenOut in the path always encodes the ERC20 address (WRAPPED_NATIVE
        # for native output) — matches the contract's _encodePath contract note.
        token_out_for_path = WBNB if token_out == NATIVE else token_out

        path = encode_path(pool_address, token_out_for_path, fee_num, fee_den, factory)

        amount_out_min = (pool_output * (10000 - slippage_bps)) // 10000

        return jsonify({
            'path': path,
            'factory': factory,
            'fee_numerator': fee_num,
            'fee_denominator': fee_den,
            'amount_out_min': str(amount_out_min),
            'pool': pool_address,
            'rpc_used': rpc_used,
            'used_fallback': used_fallback,
            'fallback_reason': fallback_reason
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
    rpc_url = data.get('rpc_url')

    if not all([token_in, token_out, amount_in, amount_out_min, recipient, path, user_address]):
        return jsonify({'error': 'Missing required parameters'}), 400

    if not validate_address(token_in) or not validate_address(token_out):
        return jsonify({'error': 'Invalid token address'}), 400

    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400

    try:
        w3i, rpc_used, used_fallback, fallback_reason = get_w3(rpc_url)
        orvix_c, _ = get_contracts(w3i)

        # Convert path from hex string to bytes if needed
        if isinstance(path, str) and path.startswith('0x'):
            path_bytes = bytes.fromhex(path[2:])
        elif isinstance(path, str):
            path_bytes = path.encode()
        else:
            path_bytes = path

        # IDENTICAL to CLI transaction building
        tx = orvix_c.functions.swapExactInput(
            w3i.to_checksum_address(token_in),
            w3i.to_checksum_address(token_out),
            int(amount_in),
            int(amount_out_min),
            w3i.to_checksum_address(recipient),
            int(deadline),
            path_bytes,
            w3i.to_checksum_address(treasury if treasury else recipient),
            w3i.to_checksum_address(integrator if integrator else recipient)
        ).build_transaction({
            "from": w3i.to_checksum_address(user_address),
            "nonce": None,  # Frontend will set
            "gas": 500000,  # Frontend will estimate
            "gasPrice": None,  # Frontend will set
            "value": int(amount_in) if token_in == NATIVE else 0,
        })

        return jsonify({
            'to': tx['to'],
            'data': tx_data_to_hex(tx['data']),
            'value': str(tx['value']),
            'gas': str(tx['gas']),
            'chainId': w3i.eth.chain_id,
            'rpc_used': rpc_used,
            'used_fallback': used_fallback,
            'fallback_reason': fallback_reason
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
    rpc_url = data.get('rpc_url')

    if not amount or not user_address:
        return jsonify({'error': 'Missing required parameters'}), 400

    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400

    try:
        w3i, rpc_used, used_fallback, fallback_reason = get_w3(rpc_url)
        _, wbnb_c = get_contracts(w3i)

        # IDENTICAL to CLI deposit() transaction building
        tx = wbnb_c.functions.deposit().build_transaction({
            "from": w3i.to_checksum_address(user_address),
            "nonce": None,  # Frontend will set
            "gas": 200000,  # Frontend will estimate
            "gasPrice": None,  # Frontend will set
            "value": int(amount),
        })

        return jsonify({
            'to': tx['to'],
            'data': tx_data_to_hex(tx['data']),
            'value': str(tx['value']),
            'gas': str(tx['gas']),
            'chainId': w3i.eth.chain_id,
            'rpc_used': rpc_used,
            'used_fallback': used_fallback,
            'fallback_reason': fallback_reason
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
    rpc_url = data.get('rpc_url')

    if not amount or not user_address:
        return jsonify({'error': 'Missing required parameters'}), 400

    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400

    try:
        w3i, rpc_used, used_fallback, fallback_reason = get_w3(rpc_url)
        _, wbnb_c = get_contracts(w3i)

        # IDENTICAL to CLI withdraw() transaction building
        tx = wbnb_c.functions.withdraw(int(amount)).build_transaction({
            "from": w3i.to_checksum_address(user_address),
            "nonce": None,  # Frontend will set
            "gas": 200000,  # Frontend will estimate
            "gasPrice": None,  # Frontend will set
            "value": 0,
        })

        return jsonify({
            'to': tx['to'],
            'data': tx_data_to_hex(tx['data']),
            'value': str(tx['value']),
            'gas': str(tx['gas']),
            'chainId': w3i.eth.chain_id,
            'rpc_used': rpc_used,
            'used_fallback': used_fallback,
            'fallback_reason': fallback_reason
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
    rpc_url = data.get('rpc_url')

    if not token_address or not user_address:
        return jsonify({'error': 'token_address and user_address required'}), 400

    if not validate_address(token_address):
        return jsonify({'error': 'Invalid token address'}), 400

    if not validate_address(user_address):
        return jsonify({'error': 'Invalid user address'}), 400

    try:
        w3i, rpc_used, used_fallback, fallback_reason = get_w3(rpc_url)
        token = w3i.eth.contract(address=w3i.to_checksum_address(token_address), abi=ERC20_ABI)

        tx = token.functions.approve(
            w3i.to_checksum_address(spender_address),
            int(amount)
        ).build_transaction({
            "from": w3i.to_checksum_address(user_address),
            "nonce": None,  # Frontend will set
            "gas": 100000,  # Frontend will estimate
            "gasPrice": None,  # Frontend will set
            "value": 0,
        })

        return jsonify({
            'to': tx['to'],
            'data': tx_data_to_hex(tx['data']),
            'value': str(tx['value']),
            'gas': str(tx['gas']),
            'chainId': w3i.eth.chain_id,
            'rpc_used': rpc_used,
            'used_fallback': used_fallback,
            'fallback_reason': fallback_reason
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

