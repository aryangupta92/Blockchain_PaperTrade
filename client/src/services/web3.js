import { ethers } from 'ethers';

// ABI compiled from BlockTrade.sol
const CONTRACT_ABI = [
  "event SubscriptionPurchased(address indexed userWallet, string planId, uint256 amountPaid)",
  "event TradeRecorded(address indexed userWallet, string symbol, string side, uint256 quantity, uint256 price, string blockHash, uint256 timestamp)",
  "event UserRegistered(address indexed userWallet, string name, string email)",
  "function PLAN_EXPERT_COST() view returns (uint256)",
  "function PLAN_PRO_COST() view returns (uint256)",
  "function PLAN_STARTER_COST() view returns (uint256)",
  "function getUserTrade(address _user, uint256 _index) view returns (tuple(string symbol, uint256 quantity, uint256 price, string side, string localBlockHash, uint256 timestamp))",
  "function getUserTradeCount(address _user) view returns (uint256)",
  "function owner() view returns (address)",
  "function purchaseSubscription(string _planId) payable",
  "function recordTrade(string _symbol, uint256 _quantity, uint256 _priceTimes100, string _side, string _localBlockHash)",
  "function registerUser(string _name, string _email)",
  "function users(address) view returns (string name, string email, string planId, uint256 virtualBalance, bool isRegistered)",
  "function withdrawFees()"
];

// Address where contract is deployed (Placeholder - user must enter after deploying on Remix)
const CONTRACT_ADDRESS = "0x0075F3eB7ed8aebC2086AE937bB7a256eec3B3E7";

export const getMetaMaskProvider = () => {
  if (!window.ethereum) return null;
  
  let provider = window.ethereum;
  if (window.ethereum.providers?.length) {
    const mm = window.ethereum.providers.find(p => p.isMetaMask && !p.isTrust && !p.isTrustWallet);
    if (mm) provider = mm;
  }
  
  if (provider.isTrust || provider.isTrustWallet) {
    throw new Error("Trust Wallet is intercepting the connection. Please disable Trust Wallet in your browser extensions or turn off 'Default Wallet' in its settings to use MetaMask.");
  }
  
  return provider;
};

export const getWeb3Provider = () => {
  const provider = getMetaMaskProvider();
  if (provider) {
    return new ethers.BrowserProvider(provider);
  }
  return null;
};

export const connectWallet = async () => {
  const ethProvider = getMetaMaskProvider();
  if (!ethProvider) throw new Error("MetaMask not found! Please install it.");

  await ethProvider.request({ method: "eth_requestAccounts" });
  
  // Enforce Sepolia Network
  const sepoliaChainId = '0xaa36a7';
  try {
    await ethProvider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: sepoliaChainId }],
    });
  } catch (switchError) {
    // This error code indicates that the chain has not been added to MetaMask.
    if (switchError.code === 4902) {
      try {
        await ethProvider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: sepoliaChainId,
              chainName: 'Sepolia test network',
              nativeCurrency: {
                name: 'SepoliaETH',
                symbol: 'SEP',
                decimals: 18
              },
              rpcUrls: ['https://sepolia.infura.io/v3/'],
              blockExplorerUrls: ['https://sepolia.etherscan.io']
            }
          ],
        });
      } catch (addError) {
        throw new Error("Failed to add Sepolia network to MetaMask");
      }
    } else {
      throw new Error("Failed to switch to Sepolia network");
    }
  }

  const browserProvider = new ethers.BrowserProvider(ethProvider);
  const signer = await browserProvider.getSigner();
  return signer.getAddress();
};

export const getContract = async (withSigner = true) => {
  const provider = getWeb3Provider();
  if (!provider) throw new Error("MetaMask not found!");
  if (CONTRACT_ADDRESS === "0xYourContractAddressHere") {
    console.warn("BlockTrade: Smart contract address not set. Web3 functions will simulate success for demo.");
    return null; // Return null so UI can degrade gracefully during demo if address is missing
  }

  if (withSigner) {
    const signer = await provider.getSigner();
    return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
  }
  return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
};

// ── Smart Contract Interactions ─────────────────────────────────────────────

export const registerOnChain = async (name, email) => {
  try {
    const contract = await getContract(true);
    if (!contract) return true; // Simulated success if no contract address yet
    const tx = await contract.registerUser(name, email);
    await tx.wait();
    return true;
  } catch (err) {
    console.error("Web3 register error:", err);
    throw err;
  }
};

export const purchaseSubscriptionOnChain = async (planId) => {
  try {
    const contract = await getContract(true);
    if (!contract) return true;

    let ethRequired = "0";
    if (planId === "starter") ethRequired = "0.001";
    if (planId === "pro") ethRequired = "0.005";
    if (planId === "expert") ethRequired = "0.01";

    const tx = await contract.purchaseSubscription(planId, {
      value: ethers.parseEther(ethRequired)
    });
    const receipt = await tx.wait();
    return receipt.hash;
  } catch (err) {
    console.error("Web3 subscription error:", err);
    throw err;
  }
};

export const recordTradeOnChain = async (symbol, qty, price, side, localHash) => {
  try {
    const contract = await getContract(true);
    if (!contract) {
      console.log("MetaMask: Simulated recording trade ->", symbol, side);
      return "simulate_tx_hash";
    }

    // Pass price * 100
    const scaledPrice = Math.floor(price * 100);

    const tx = await contract.recordTrade(symbol, qty, scaledPrice, side.toLowerCase(), localHash);
    await tx.wait();
    return tx.hash;
  } catch (err) {
    console.error("Web3 trade record error:", err);
    throw err;
  }
};
