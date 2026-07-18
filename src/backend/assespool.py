from dotenv import load_dotenv
load_dotenv(".env")

from web3 import Web3
from web3.middleware import geth_poa_middleware
from eth_account import Account
import os                                               import sys
import re
from decimal import Decimal
from datetime import datetime

RPC_URL = os.environ["RPC_URL"]
PRIVATE_KEY = os.environ["PRIVATE_KEY"]

w3 = Web3(Web3.HTTPProvider(RPC_URL))
w3.middleware_onion.inject(geth_poa_middleware, layer=0)
account = Account.from_key(PRIVATE_KEY)

NATIVE = "0x0000000000000000000000000000000000000000"
ORVIX_AGGREGATOR = "0xA4Bf191D53B880cA49F1ceD0C0C840378bdDef42"
WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd"

TREASURY = os.environ.get("TREASURY", account.address)
INTEGRATOR = os.environ.get("INTEGRATOR", account.address)

MAX_PRICE_IMPACT = 1000  # persen

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

def decode_custom_error(error_data):
    if error_data.startswith("0x71c4efed"):
        try:
            data = bytes.fromhex(error_data[10:])
            if len(data) >= 64:
                amount_out = int.from_bytes(data[0:32], 'big')
                min_amount = int.from_bytes(data[32:64], 'big')
                return f"SlippageExceeded(amountOut={amount_out}, minAmountOut={min_amount})"
        except:
            pass

    error_map = {
        "0x08c379a0": "Error(string)",
        "0x13c9b4a8": "Expired()",
        "0x4e6ecda7": "InvalidPath()",
        "0xc85d0ccd": "InvalidPool()",
        "0x97a96f05": "ZeroAddress()",
        "0x1f15a6e5": "ZeroAmount()",
        "0x4a1ebbb2": "InsufficientLiquidity()",
        "0x69c83c3b": "OnlyWrappedNative()",
        "0xd01a83a0": "CircuitBreakerActive()",
    }

    for selector, name in error_map.items():
        if error_data.startswith(selector):
            return name

    return f"Unknown error: {error_data[:10]}..."

def decode_revert_reason(tx_hash):
    try:
        tx = w3.eth.get_transaction(tx_hash)
        receipt = w3.eth.get_transaction_receipt(tx_hash)

        if receipt.status == 0:
            try:
                w3.eth.call({
                    'from': tx['from'],
                    'to': tx['to'],
                    'data': tx['input'],
                    'gas': tx['gas'],
                    'gasPrice': tx['gasPrice'],
                    'value': tx['value']
                }, block_identifier=receipt.blockNumber)
                return "No revert reason"
            except Exception as e:
                error_msg = str(e)

                if 'execution reverted' in error_msg:
                    match = re.search(r'0x08c379a0([0-9a-f]+)', error_msg)
                    if match:
                        try:
                            data = bytes.fromhex(match.group(1))
                            offset = int.from_bytes(data[0:32], 'big')
                            length = int.from_bytes(data[offset:offset+32], 'big')
                            return data[offset+32:offset+32+length].decode('utf-8')
                        except:
                            pass

                    match = re.search(r'reverted with (0x[0-9a-f]+)', error_msg)
                    if match:
                        return decode_custom_error(match.group(1))

                    match = re.search(r'execution reverted: (.+)', error_msg)
                    if match:
                        return match.group(1)

                return error_msg[:200]
    except Exception as e:
        return f"Failed to decode: {e}"

    return "Unknown"

def get_token_info(addr):
    if addr == NATIVE:
        bal = w3.eth.get_balance(account.address)
        return {"symbol": "BNB", "decimals": 18, "balance": bal, "address": NATIVE}
    c = w3.eth.contract(address=w3.to_checksum_address(addr), abi=ERC20_ABI)
    return {
        "symbol": c.functions.symbol().call(),
        "decimals": c.functions.decimals().call(),
        "balance": c.functions.balanceOf(account.address).call(),
        "address": addr,
        "contract": c,
    }

def get_token_balance(addr):
    if addr == NATIVE:
        return w3.eth.get_balance(account.address)
    c = w3.eth.contract(address=w3.to_checksum_address(addr), abi=ERC20_ABI)
    return c.functions.balanceOf(account.address).call()

def get_allowance(token_addr, spender_addr):
    if token_addr == NATIVE:
        return 0
    c = w3.eth.contract(address=w3.to_checksum_address(token_addr), abi=ERC20_ABI)
    return c.functions.allowance(account.address, spender_addr).call()

def ensure_approved(token_info, spender_addr, amount):
    if token_info["address"] == NATIVE:
        return True

    c = token_info["contract"]
    decimals = token_info["decimals"]
    allowance = c.functions.allowance(account.address, spender_addr).call()

    if allowance >= amount:
        print(f"✅ Allowance: {allowance / 10**decimals:.6f}")
        return True

    print(f"⏳ Approving max... (current: {allowance / 10**decimals:.6f})")
    MAX = 2**256 - 1

    try:
        tx = c.functions.approve(spender_addr, MAX).build_transaction({
            "from": account.address,
            "nonce": w3.eth.get_transaction_count(account.address, "pending"),
            "gasPrice": w3.to_wei(1, "gwei"),
            "gas": 100_000,
        })

        signed = account.sign_transaction(tx)
        txh = w3.eth.send_raw_transaction(signed.rawTransaction)
        print(f"📡 Tx: {txh.hex()}")

        receipt = w3.eth.wait_for_transaction_receipt(txh)
        if receipt.status == 1:
            print("✅ Approved")
            return True
        else:
            print("❌ Approve failed")
            return False
    except Exception as e:
        print(f"❌ Approve error: {e}")
        return False

def get_slippage():
    print("\nSlippage:")
    print("[1] Auto (0.5%)")
    print("[2] 1%")
    print("[3] 5%")
    print("[4] 10%")
    print("[5] Custom")

    choice = input("Pilih: ").strip()

    mapping = {
        "1": 50,
        "2": 100,
        "3": 500,
        "4": 1000,
    }

    if choice == "5":
        try:
            pct = float(input("Masukkan %: "))
            return int(pct * 100)
        except:
            return 50
    else:
        return mapping.get(choice, 50)

def get_amount(balance, decimals, symbol, is_native=False):
    print(f"\n📊 Balance {symbol}: {balance / 10**decimals:.6f}")

    raw = input(
        f"\nAmount {symbol} "
        "(25/50/75/max atau angka): "
    ).lower().strip()

    if raw == "b":
        return None

    if raw == "25":
        return balance // 4
    elif raw == "50":
        return balance // 2
    elif raw == "75":
        return balance * 75 // 100
    elif raw == "max":
        if is_native:
            gas_price = w3.eth.gas_price
            gas_limit = 300_000
            gas_reserve = int(gas_price * gas_limit * 1.1)
            return balance - gas_reserve if balance > gas_reserve else 0
        else:
            return balance

    try:
        amount = int(Decimal(raw) * 10**decimals)
        if amount <= 0:
            print("❌ Amount harus > 0")
            return None
        if amount > balance:
            amount = balance  # clamp, antisipasi sisa rounding
        return amount
    except (ValueError, ArithmeticError):
        print("❌ Input tidak valid")
        return None

def print_header():
    os.system('clear' if os.name == 'posix' else 'cls')
    bnb_bal = w3.eth.get_balance(account.address) / 10**18
    nonce = w3.eth.get_transaction_count(account.address)
    print(f"""
╔══════════════════════════════════════════════════════════╗
║                    ORVIX CLI v1.0                        ║
╠══════════════════════════════════════════════════════════╣
║ Wallet  : {account.address[:6]}...{account.address[-4:]}                           ║
║ Network : BSC Testnet                                    ║
║ BNB     : {bnb_bal:.4f}                                  ║
║ Nonce   : {nonce}                                        ║
╚══════════════════════════════════════════════════════════╝
""")

def print_menu():
    print("""
[1] Swap
[2] Wrap BNB → WBNB
[3] Unwrap WBNB → BNB
[4] Approve Token
[5] Wallet Balance
[6] Pool Assessment
[7] Quote Only
[8] Settings
[9] Swap with custom logic (swapExactInput with path selection)
[0] Exit
""")

def menu_swap_with_logic(orvix):
    print_header()
    print("\n┌────────────────────────────────────────────┐")
    print("│         SWAP WITH CUSTOM LOGIC            │")
    print("└────────────────────────────────────────────┘")

    TOKEN_IN = input("\ntokenIn (0x0 = native BNB): ").strip()
    if TOKEN_IN.lower() == "b" or TOKEN_IN.lower() == "0":
        return

    TOKEN_OUT = input("tokenOut (0x0 = native BNB): ").strip()
    if TOKEN_OUT.lower() == "b" or TOKEN_OUT.lower() == "0":
        return

    try:
        info_in = get_token_info(TOKEN_IN)
        info_out = get_token_info(TOKEN_OUT)
    except Exception as e:
        print(f"❌ Error: {e}")
        input("Tekan Enter...")
        return

    print(f"\n📊 Balance {info_in['symbol']}:  {info_in['balance'] / 10**info_in['decimals']:.6f}")
    print(f"📊 Balance {info_out['symbol']}: {info_out['balance'] / 10**info_out['decimals']:.6f}")

    amount_in = get_amount(info_in["balance"], info_in["decimals"], info_in["symbol"], info_in["address"] == NATIVE)
    if amount_in is None:
        return

    slippage_bps = get_slippage()

    print("\n⏳ Getting pool assessments...")
    try:
        assessments = orvix.functions.assessPools(
            w3.to_checksum_address(TOKEN_IN),
            w3.to_checksum_address(TOKEN_OUT),
            amount_in,
            [],
            False
        ).call({"from": account.address})
    except Exception as e:
        print(f"❌ Assessment gagal: {e}")
        input("Tekan Enter...")
        return

    if len(assessments) == 0:
        print("\n❌ No pools found")
        input("Tekan Enter...")
        return

    # Sort by score descending
    assessments = sorted(assessments, key=lambda x: x[4], reverse=True)

    print("\n┌────────────────────────────────────────────┐")
    print("│         SELECT POOL FOR SWAP              │")
    print("└────────────────────────────────────────────┘")

    for i, assessment in enumerate(assessments):
        pool, output, liquidity, impact, score, eligible, failReason = assessment
        impact_pct = impact / 100
        output_formatted = output / (10 ** info_out['decimals'])
        liquidity_formatted = liquidity / 10**18

        status = "✅" if eligible else "❌"
        print(f"\n[{i+1}] Pool        : {pool}")
        print(f"    Output      : {output_formatted:.6f} {info_out['symbol']}")
        print(f"    Liquidity   : {liquidity_formatted:.2f}")
        print(f"    Impact      : {impact_pct:.2f}%")
        print(f"    Score       : {score}")
        print(f"    Status      : {status}")
        if i == 0 and eligible:
            print(f"    ⭐ BEST POOL")

    print("\nPilih pool number (atau 'b' untuk back): ")
    choice = input("> ").strip()
    if choice.lower() == "b":
        return

    try:
        pool_index = int(choice) - 1
        if pool_index < 0 or pool_index >= len(assessments):
            print("❌ Invalid pool selection")
            input("Tekan Enter...")
            return
    except ValueError:
        print("❌ Invalid input")
        input("Tekan Enter...")
        return

    selected_pool = assessments[pool_index]
    if not selected_pool[5]:  # eligible
        print("❌ Selected pool is not eligible for swap")
        input("Tekan Enter...")
        return

    pool_address = selected_pool[0]
    price_impact_pct = selected_pool[3] / 100

    if price_impact_pct >= MAX_PRICE_IMPACT:
        print(f"\n🔴 HIGH PRICE IMPACT!")
        print(f"Impact {price_impact_pct:.2f}% melewati batas {MAX_PRICE_IMPACT}%")
        print("Swap dibatalkan")
        input("Tekan Enter...")
        return

    # Get quote for the selected pool
    try:
        result = orvix.functions.quoteExactInput(
            w3.to_checksum_address(TOKEN_IN),
            w3.to_checksum_address(TOKEN_OUT),
            amount_in, [], slippage_bps
        ).call({"from": account.address})
    except Exception as e:
        print(f"❌ Quote gagal: {e}")
        input("Tekan Enter...")
        return

    amount_out = result[1]
    amount_out_min = result[3]
    path = result[4]

    amt_in = amount_in / (10 ** info_in["decimals"])
    amt_out = amount_out / (10 ** info_out["decimals"])
    rate = amt_out / amt_in if amt_in > 0 else 0

    print("\n┌────────────────────────────────────────────┐")
    print("│              SWAP DETAILS                │")
    print("└────────────────────────────────────────────┘")
    print(f"\n{amt_in:.6f} {info_in['symbol']}")
    print("        ↓")
    print(f"{amt_out:.6f} {info_out['symbol']}")
    print(f"\nRate         : 1 {info_in['symbol']} = {rate:.6f} {info_out['symbol']}")
    print(f"Pool         : {pool_address}")
    print(f"Impact       : {price_impact_pct:.2f}%")

    print("\n[Y] Confirm Swap  [B] Back")
    confirm = input("> ").strip().lower()
    if confirm != "y":
        return

    # ── APPROVE ──
    if not ensure_approved(info_in, ORVIX_AGGREGATOR, amount_in):
        input("❌ Approve gagal. Tekan Enter...")
        return

    # ── BUILD & SEND ──
    value = amount_in if TOKEN_IN == NATIVE else 0
    deadline = 9999999999

    tx = orvix.functions.swapExactInput(
        w3.to_checksum_address(TOKEN_IN),
        w3.to_checksum_address(TOKEN_OUT),
        amount_in,
        amount_out_min,
        account.address,
        deadline,
        path,
        w3.to_checksum_address(TREASURY),
        w3.to_checksum_address(INTEGRATOR)
    ).build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address, "pending"),
        "gasPrice": w3.to_wei(1, "gwei"),
        "gas": 500_000,
        "value": value,
    })

    try:
        estimated_gas = w3.eth.estimate_gas(tx)
        tx["gas"] = int(estimated_gas * 1.2)
        print(f"\nEstimated Gas: {estimated_gas}")
        print(f"Gas Cost:      ~{(tx['gas'] * tx['gasPrice']) / 10**18:.6f} BNB")
    except:
        print("\n⚠️  Gas estimation failed, using fallback")
        tx["gas"] = 500_000

    print("\n⏳ Sending transaction...")

    try:
        signed_tx = account.sign_transaction(tx)
        txh = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
        print(f"📡 Tx: {txh.hex()}")

        receipt = w3.eth.wait_for_transaction_receipt(txh, timeout=60)

        if receipt.status == 1:
            info_in2 = get_token_info(TOKEN_IN)
            info_out2 = get_token_info(TOKEN_OUT)
            received = (info_out2['balance'] - info_out['balance']) / 10**info_out['decimals']

            print("\n┌────────────────────────────────────────────┐")
            print("│         ✅ SWAP SUCCESS                   │")
            print("└────────────────────────────────────────────┘")
            print(f"\nSold      : {amount_in / 10**info_in['decimals']:.6f} {info_in['symbol']}")
            print(f"Received  : {received:.6f} {info_out['symbol']}")

            if received > 0:
                actual_rate = received / (amount_in / 10**info_in['decimals'])
                print(f"Avg Price : {actual_rate:.6f} {info_out['symbol']}/{info_in['symbol']}")

            print(f"\nGas Used  : {receipt.gasUsed}")
            print(f"Block     : {receipt.blockNumber}")
            print(f"Tx        : {txh.hex()}")
            print(f"Explorer  : https://testnet.bscscan.com/tx/{txh.hex()}")

            print(f"\n📊 Balance {info_in2['symbol']}:  {info_in2['balance'] / 10**info_in2['decimals']:.6f}")
            print(f"📊 Balance {info_out2['symbol']}: {info_out2['balance'] / 10**info_out2['decimals']:.6f}")
        else:
            print("\n❌ SWAP FAILED")
            reason = decode_revert_reason(txh)
            print(f"Reason: {reason}")

    except Exception as e:
        print(f"❌ Swap gagal: {e}")

    input("\nTekan Enter untuk kembali...")

def menu_swap(orvix):
    print_header()
    print("\n┌────────────────────────────────────────────┐")
    print("│              SWAP                         │")
    print("└────────────────────────────────────────────┘")

    TOKEN_IN = input("\ntokenIn (0x0 = native BNB): ").strip()
    if TOKEN_IN.lower() == "b":
        return

    TOKEN_OUT = input("tokenOut (0x0 = native BNB): ").strip()
    if TOKEN_OUT.lower() == "b":
        return

    try:
        info_in = get_token_info(TOKEN_IN)
        info_out = get_token_info(TOKEN_OUT)
    except Exception as e:
        print(f"❌ Error: {e}")
        input("Tekan Enter...")
        return

    print(f"\n📊 Balance {info_in['symbol']}:  {info_in['balance'] / 10**info_in['decimals']:.6f}")
    print(f"📊 Balance {info_out['symbol']}: {info_out['balance'] / 10**info_out['decimals']:.6f}")

    amount_in = get_amount(info_in["balance"], info_in["decimals"], info_in["symbol"])
    if amount_in is None:
        return

    slippage_bps = get_slippage()

    print("\n⏳ Quoting...")
    try:
        result = orvix.functions.quoteExactInput(
            w3.to_checksum_address(TOKEN_IN),
            w3.to_checksum_address(TOKEN_OUT),
            amount_in, [], slippage_bps
        ).call({"from": account.address})
    except Exception as e:
        print(f"❌ Quote gagal: {e}")
        input("Tekan Enter...")
        return

    amount_out = result[1]
    amount_out_min = result[3]
    price_impact_raw = result[2]
    path = result[4]
    best_pool = result[7]

    amt_in = amount_in / (10 ** info_in["decimals"])
    amt_out = amount_out / (10 ** info_out["decimals"])
    rate = amt_out / amt_in if amt_in > 0 else 0
    amt_out_min = amount_out_min / (10 ** info_out["decimals"])
    price_impact_pct = price_impact_raw / 100

    print("\n┌────────────────────────────────────────────┐")
    print("│              QUOTE                        │")
    print("└────────────────────────────────────────────┘")

    impact_icon = "�" if price_impact_pct < 5 else "�" if price_impact_pct < 10 else "🔴"

    print(f"\n{amt_in:.6f} {info_in['symbol']}")
    print("        ↓")
    print(f"{amt_out:.6f} {info_out['symbol']}")

    print(f"\nRate         : 1 {info_in['symbol']} = {rate:.6f} {info_out['symbol']}")
    print(f"Min Receive  : {amt_out_min:.6f} {info_out['symbol']}")
    print(f"Impact       : {impact_icon} {price_impact_pct:.2f}%")
    print(f"Slippage     : {slippage_bps / 100:.1f}%")
    print(f"Pool         : {best_pool}")

    if price_impact_pct >= MAX_PRICE_IMPACT:
        print(f"\n🔴 HIGH PRICE IMPACT!")
        print(f"Impact {price_impact_pct:.2f}% melewati batas {MAX_PRICE_IMPACT}%")
        print("Swap dibatalkan")
        input("\n[B] Back: ")
        return

    print("\n[Y] Swap  [R] Requote  [B] Back")
    choice = input("> ").strip().lower()
    if choice != "y":
        return

    # ── APPROVE ──
    if not ensure_approved(info_in, ORVIX_AGGREGATOR, amount_in):
        input("❌ Approve gagal. Tekan Enter...")
        return

    # ── BUILD & SEND ──
    value = amount_in if TOKEN_IN == NATIVE else 0
    deadline = 9999999999

    tx = orvix.functions.swapExactInput(
        w3.to_checksum_address(TOKEN_IN),
        w3.to_checksum_address(TOKEN_OUT),
        amount_in,
        amount_out_min,
        account.address,
        deadline,
        path,
        w3.to_checksum_address(TREASURY),
        w3.to_checksum_address(INTEGRATOR)
    ).build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address, "pending"),
        "gasPrice": w3.to_wei(1, "gwei"),
        "gas": 500_000,
        "value": value,
    })

    try:
        estimated_gas = w3.eth.estimate_gas(tx)
        tx["gas"] = int(estimated_gas * 1.2)
        print(f"\nEstimated Gas: {estimated_gas}")
        print(f"Gas Cost:      ~{(tx['gas'] * tx['gasPrice']) / 10**18:.6f} BNB")
    except:
        print("\n⚠️  Gas estimation failed, using fallback")
        tx["gas"] = 500_000

    print("\n⏳ Sending transaction...")

    try:
        signed_tx = account.sign_transaction(tx)
        txh = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
        print(f"📡 Tx: {txh.hex()}")

        receipt = w3.eth.wait_for_transaction_receipt(txh, timeout=60)

        if receipt.status == 1:
            info_in2 = get_token_info(TOKEN_IN)
            info_out2 = get_token_info(TOKEN_OUT)
            received = (info_out2['balance'] - info_out['balance']) / 10**info_out['decimals']

            print("\n┌────────────────────────────────────────────┐")
            print("│         ✅ SWAP SUCCESS                   │")
            print("└────────────────────────────────────────────┘")
            print(f"\nSold      : {amount_in / 10**info_in['decimals']:.6f} {info_in['symbol']}")
            print(f"Received  : {received:.6f} {info_out['symbol']}")

            if received > 0:
                actual_rate = received / (amount_in / 10**info_in['decimals'])
                print(f"Avg Price : {actual_rate:.6f} {info_out['symbol']}/{info_in['symbol']}")

            print(f"\nGas Used  : {receipt.gasUsed}")
            print(f"Block     : {receipt.blockNumber}")
            print(f"Tx        : {txh.hex()}")
            print(f"Explorer  : https://testnet.bscscan.com/tx/{txh.hex()}")

            print(f"\n📊 Balance {info_in2['symbol']}:  {info_in2['balance'] / 10**info_in2['decimals']:.6f}")
            print(f"📊 Balance {info_out2['symbol']}: {info_out2['balance'] / 10**info_out2['decimals']:.6f}")
        else:
            print("\n❌ SWAP FAILED")
            reason = decode_revert_reason(txh)
            print(f"Reason: {reason}")

    except Exception as e:
        print(f"❌ Swap gagal: {e}")

    input("\nTekan Enter untuk kembali...")

def menu_approve():
    print_header()
    print("\n┌────────────────────────────────────────────┐")
    print("│              APPROVE                      │")
    print("└────────────────────────────────────────────┘")

    token_addr = input("\nToken address: ").strip()
    if token_addr.lower() == "b":
        return

    try:
        info = get_token_info(token_addr)
    except Exception as e:
        print(f"❌ Error: {e}")
        input("Tekan Enter...")
        return

    allowance = get_allowance(token_addr, ORVIX_AGGREGATOR)
    print(f"\nToken     : {info['symbol']}")
    print(f"Allowance : {allowance / 10**info['decimals']:.6f}")

    if allowance >= 2**256 - 1:
        print("✅ Already approved max")
        input("Tekan Enter...")
        return

    print("\n[Y] Approve Max  [B] Back")
    choice = input("> ").strip().lower()
    if choice != "y":
        return

    ensure_approved(info, ORVIX_AGGREGATOR, 2**256 - 1)
    input("Tekan Enter...")

def menu_wallet():
    print_header()
    print("\n┌────────────────────────────────────────────┐")
    print("│              WALLET                       │")
    print("└────────────────────────────────────────────┘")

    bnb = w3.eth.get_balance(account.address) / 10**18
    print(f"\nBNB : {bnb:.6f}")

    token_list = [
        "0x0b826aFC12380Cd138ED9e7211631033fa51716F",  # USST
        "0xE844E1201df67D3c4aAA5656b2296a775C9F844A",  # TRAV
        "0xF504A700fe1eC44A565cd4b5a2f6c6f536b5FB98",  # BTS
        "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",  # WBNB
    ]

    for addr in token_list:
        try:
            info = get_token_info(addr)
            if info['balance'] > 0:
                print(f"{info['symbol']:<8} : {info['balance'] / 10**info['decimals']:.6f}")
        except:
            pass

    input("\nTekan Enter untuk kembali...")

def menu_wrap():
    print_header()
    print("\n┌────────────────────────────────────────────┐")
    print("│              WRAP BNB → WBNB              │")
    print("└────────────────────────────────────────────┘")

    bnb_bal = w3.eth.get_balance(account.address)
    print(f"\nBNB Balance  : {bnb_bal / 10**18:.6f}")

    wbnb = w3.eth.contract(address=w3.to_checksum_address(WBNB), abi=WBNB_ABI)
    wbnb_bal = wbnb.functions.balanceOf(account.address).call()
    print(f"WBNB Balance : {wbnb_bal / 10**18:.6f}")

    if bnb_bal == 0:
        print("❌ No BNB to wrap")
        input("Tekan Enter...")
        return

    raw = input(f"\nAmount BNB (max atau angka): ").lower().strip()
    if raw == "b":
        return

    if raw == "max":
        amount = bnb_bal
    else:
        try:
            amount = int(float(raw) * 10**18)
        except:
            print("❌ Invalid")
            return

    if amount <= 0 or amount > bnb_bal:
        print("❌ Invalid amount")
        return

    print(f"\nWrap {amount / 10**18:.6f} BNB → WBNB")
    print("[Y] Wrap  [B] Back")
    choice = input("> ").strip().lower()
    if choice != "y":
        return

    tx = wbnb.functions.deposit().build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address, "pending"),
        "gasPrice": w3.to_wei(1, "gwei"),
        "gas": 200_000,
        "value": amount,
    })

    try:
        signed = account.sign_transaction(tx)
        txh = w3.eth.send_raw_transaction(signed.rawTransaction)
        print(f"📡 Tx: {txh.hex()}")
        receipt = w3.eth.wait_for_transaction_receipt(txh)

        if receipt.status == 1:
            print("✅ Wrap SUCCESS")
        else:
            print("❌ Wrap FAILED")
    except Exception as e:
        print(f"❌ Error: {e}")

    input("Tekan Enter...")

def menu_unwrap():
    print_header()
    print("\n┌────────────────────────────────────────────┐")
    print("│              UNWRAP WBNB → BNB            │")
    print("└────────────────────────────────────────────┘")

    wbnb = w3.eth.contract(address=w3.to_checksum_address(WBNB), abi=WBNB_ABI)
    wbnb_bal = wbnb.functions.balanceOf(account.address).call()
    print(f"\nWBNB Balance : {wbnb_bal / 10**18:.6f}")

    bnb_bal = w3.eth.get_balance(account.address)
    print(f"BNB Balance  : {bnb_bal / 10**18:.6f}")

    if wbnb_bal == 0:
        print("❌ No WBNB to unwrap")
        input("Tekan Enter...")
        return

    raw = input(f"\nAmount WBNB (max atau angka): ").lower().strip()
    if raw == "b":
        return

    if raw == "max":
        amount = wbnb_bal
    else:
        try:
            amount = int(float(raw) * 10**18)
        except:
            print("❌ Invalid")
            return

    if amount <= 0 or amount > wbnb_bal:
        print("❌ Invalid amount")
        return

    print(f"\nUnwrap {amount / 10**18:.6f} WBNB → BNB")
    print("[Y] Unwrap  [B] Back")
    choice = input("> ").strip().lower()
    if choice != "y":
        return

    tx = wbnb.functions.withdraw(amount).build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address, "pending"),
        "gasPrice": w3.to_wei(1, "gwei"),
        "gas": 200_000,
    })

    try:
        signed = account.sign_transaction(tx)
        txh = w3.eth.send_raw_transaction(signed.rawTransaction)
        print(f"📡 Tx: {txh.hex()}")
        receipt = w3.eth.wait_for_transaction_receipt(txh)

        if receipt.status == 1:
            print("✅ Unwrap SUCCESS")
        else:
            print("❌ Unwrap FAILED")
    except Exception as e:
        print(f"❌ Error: {e}")

    input("Tekan Enter...")

def menu_pool_assessment(orvix):
    print_header()
    print("\n┌────────────────────────────────────────────┐")
    print("│           POOL ASSESSMENT                 │")
    print("└────────────────────────────────────────────┘")

    TOKEN_IN = input("\ntokenIn (0x0 = native BNB): ").strip()
    if TOKEN_IN.lower() == "b":
        return

    TOKEN_OUT = input("tokenOut (0x0 = native BNB): ").strip()
    if TOKEN_OUT.lower() == "b":
        return

    try:
        info_in = get_token_info(TOKEN_IN)
        info_out = get_token_info(TOKEN_OUT)
    except Exception as e:
        print(f"❌ Error: {e}")
        input("Tekan Enter...")
        return

    print(f"\n📊 Balance {info_in['symbol']}:  {info_in['balance'] / 10**info_in['decimals']:.6f}")
    print(f"📊 Balance {info_out['symbol']}: {info_out['balance'] / 10**info_out['decimals']:.6f}")

    amount_in = get_amount(info_in["balance"], info_in["decimals"], info_in["symbol"])
    if amount_in is None:
        return

    print("\n⏳ Assessing pools...")
    try:
        assessments = orvix.functions.assessPools(
            w3.to_checksum_address(TOKEN_IN),
            w3.to_checksum_address(TOKEN_OUT),
            amount_in,
            [],
            False  # rawMode = false (filter by price impact)
        ).call({"from": account.address})
    except Exception as e:
        print(f"❌ Assessment gagal: {e}")
        input("Tekan Enter...")
        return

    print("\n┌────────────────────────────────────────────┐")
    print("│           ASSESSMENT RESULTS              │")
    print("└────────────────────────────────────────────┘")

    if len(assessments) == 0:
        print("\n❌ No pools found")
        input("Tekan Enter...")
        return

    # Sort by score descending
    assessments = sorted(assessments, key=lambda x: x[4], reverse=True)

    for i, assessment in enumerate(assessments):
        pool, output, liquidity, impact, score, eligible, failReason = assessment

        impact_pct = impact / 100
        output_formatted = output / (10 ** info_out['decimals'])
        liquidity_formatted = liquidity / 10**18

        status = "✅" if eligible else "❌"
        fail_reason_str = "None"
        if failReason > 0:
            reasons = []
            if failReason & 1: reasons.append("ZERO_RESERVE")
            if failReason & 2: reasons.append("ZERO_OUTPUT")
            if failReason & 4: reasons.append("ZERO_LIQUIDITY")
            if failReason & 8: reasons.append("PRICE_IMPACT")
            if failReason & 16: reasons.append("CIRCUIT_BREAKER")
            fail_reason_str = " | ".join(reasons)

        print(f"\n[{i+1}] Pool        : {pool}")
        print(f"    Output      : {output_formatted:.6f} {info_out['symbol']}")
        print(f"    Liquidity   : {liquidity_formatted:.2f}")
        print(f"    Impact      : {impact_pct:.2f}%")
        print(f"    Score       : {score}")
        print(f"    Status      : {status} {fail_reason_str}")

        # Highlight best pool
        if i == 0 and eligible:
            print(f"    ⭐ BEST POOL")

    input("\nTekan Enter untuk kembali...")

def menu_quote_only(orvix):
    print_header()
    print("\n┌────────────────────────────────────────────┐")
    print("│              QUOTE ONLY                   │")
    print("└────────────────────────────────────────────┘")

    TOKEN_IN = input("\ntokenIn (0x0 = native BNB): ").strip()
    if TOKEN_IN.lower() == "b":
        return

    TOKEN_OUT = input("tokenOut (0x0 = native BNB): ").strip()
    if TOKEN_OUT.lower() == "b":
        return

    try:
        info_in = get_token_info(TOKEN_IN)
        info_out = get_token_info(TOKEN_OUT)
    except Exception as e:
        print(f"❌ Error: {e}")
        input("Tekan Enter...")
        return

    print(f"\n📊 Balance {info_in['symbol']}:  {info_in['balance'] / 10**info_in['decimals']:.6f}")
    print(f"📊 Balance {info_out['symbol']}: {info_out['balance'] / 10**info_out['decimals']:.6f}")

    amount_in = get_amount(info_in["balance"], info_in["decimals"], info_in["symbol"])
    if amount_in is None:
        return

    slippage_bps = get_slippage()

    print("\n⏳ Quoting...")
    try:
        result = orvix.functions.quoteExactInput(
            w3.to_checksum_address(TOKEN_IN),
            w3.to_checksum_address(TOKEN_OUT),
            amount_in, [], slippage_bps
        ).call({"from": account.address})
    except Exception as e:
        print(f"❌ Quote gagal: {e}")
        input("Tekan Enter...")
        return

    amount_out = result[1]
    amount_out_min = result[3]
    price_impact_raw = result[2]
    path = result[4]
    best_pool = result[7]

    amt_in = amount_in / (10 ** info_in["decimals"])
    amt_out = amount_out / (10 ** info_out["decimals"])
    rate = amt_out / amt_in if amt_in > 0 else 0
    amt_out_min = amount_out_min / (10 ** info_out["decimals"])
    price_impact_pct = price_impact_raw / 100

    print("\n┌────────────────────────────────────────────┐")
    print("│              QUOTE RESULT                 │")
    print("└────────────────────────────────────────────┘")

    impact_icon = "�" if price_impact_pct < 5 else "�" if price_impact_pct < 10 else "🔴"

    print(f"\n{amt_in:.6f} {info_in['symbol']}")
    print("        ↓")
    print(f"{amt_out:.6f} {info_out['symbol']}")

    print(f"\nRate         : 1 {info_in['symbol']} = {rate:.6f} {info_out['symbol']}")
    print(f"Min Receive  : {amt_out_min:.6f} {info_out['symbol']}")
    print(f"Impact       : {impact_icon} {price_impact_pct:.2f}%")
    print(f"Slippage     : {slippage_bps / 100:.1f}%")
    print(f"Pool         : {best_pool}")

    if price_impact_pct >= MAX_PRICE_IMPACT:
        print(f"\n🔴 HIGH PRICE IMPACT! (> {MAX_PRICE_IMPACT}%)")

    input("\nTekan Enter untuk kembali...")

def main():
    orvix = w3.eth.contract(address=w3.to_checksum_address(ORVIX_AGGREGATOR), abi=ORVIX_ABI)

    while True:
        print_header()
        print_menu()

        choice = input("Select > ").strip()

        if choice == "1":
            menu_swap(orvix)
        elif choice == "2":
            menu_wrap()
        elif choice == "3":
            menu_unwrap()
        elif choice == "4":
            menu_approve()
        elif choice == "5":
            menu_wallet()
        elif choice == "6":
            menu_pool_assessment(orvix)
        elif choice == "7":
            menu_quote_only(orvix)
        elif choice == "8":
            print("\nSettings:")
            print(f"Treasury   : {TREASURY}")
            print(f"Integrator : {INTEGRATOR}")
            print(f"Max Impact : {MAX_PRICE_IMPACT}%")
            input("\nTekan Enter...")
        elif choice == "9":
            menu_swap_with_logic(orvix)
        elif choice == "0":
            print("\n👋 Selesai.")
            break
        else:
            print("❌ Invalid choice")
            input("Tekan Enter...")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n👋 Interrupted")
        sys.exit(0)