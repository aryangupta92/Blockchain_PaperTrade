# BlockTrade: Smart Contract Deployment Guide (Remix + MetaMask)

This guide will walk you through deploying your `BlockTrade.sol` smart contract using Remix IDE and connecting it to the frontend via MetaMask.

## Step 1: Install MetaMask and Get Testnet ETH

1. **Install MetaMask**: If you haven't already, install the [MetaMask browser extension](https://metamask.io/).
2. **Switch to Sepolia Network**: 
   - Open MetaMask, click the network dropdown at the top left.
   - Toggle **"Show test networks"** to ON.
   - Select **Sepolia**.
3. **Get Free Test ETH**: 
   - You need fake "Sepolia ETH" to pay for deployment gas fees.
   - Go to [Google Sepolia Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) or [Alchemy Faucet](https://sepoliafaucet.com/).
   - Paste your wallet address and request ETH.

## Step 2: Open Remix IDE and Compile

1. Go to **[remix.ethereum.org](https://remix.ethereum.org/)**.
2. Under the **File Explorer** tab (first icon on the left), click the **Create New File** icon.
3. Name the file `BlockTrade.sol`.
4. Open the `blockchain/BlockTrade.sol` file from your local project (using VS Code) and **copy all its contents**.
5. **Paste** the contents into the blank `BlockTrade.sol` tab inside your browser running Remix.
6. Click on the **Solidity Compiler** tab (third icon on the left).
7. Ensure the compiler version is set to `0.8.19` (or above) and click the big blue **Compile BlockTrade.sol** button. It should show a green checkmark when successful.

## Step 3: Connect MetaMask to Remix

1. Click on the **Deploy & Run Transactions** tab (fourth icon on the left).
2. At the top, look for the **ENVIRONMENT** dropdown.
3. Change it from "Remix VM (London)" to **"Injected Provider - MetaMask"**.
4. MetaMask will immediately pop up and ask you to connect your wallet to Remix. Click **Next** -> **Connect**.
5. Once connected, the "Account" section below the dropdown should show your MetaMask wallet address and your Sepolia ETH balance (e.g., `0x123... (0.5 ether)`).

## Step 4: Deploy the Contract

1. Ensure the **CONTRACT** dropdown has `BlockTrade - BlockTrade.sol` selected.
2. Click the orange **Deploy** button.
3. MetaMask will pop up again, asking you to confirm the transaction and pay the gas fee to deploy the contract. 
4. Click **Confirm** in MetaMask.
5. Wait ~15 seconds. At the bottom of the Remix screen, under "Deployed Contracts", you will see `BLOCKTRADE` appear.

## Step 5: Connect the App to the Contract

1. Under "Deployed Contracts", click the small **Copy Icon** next to the deployed Contract Address (it looks like `0x...`).
2. Open your VS Code and navigate to `client/src/services/web3.js`.
3. Go to line 20: 
   ```javascript
   const CONTRACT_ADDRESS = "0xYourContractAddressHere";
   ```
4. Replace `"0xYourContractAddressHere"` with the actual address you just copied from Remix.
5. Save the file.

## Step 6: Test the Integration on Your App

1. Ensure your React app is running (`npm run dev`).
2. Open the app in the same browser where MetaMask is installed.
3. Click **Connect Wallet** in the top right corner of the BlockTrade Navbar.
4. Go to the **Trading** page and place a dummy order. 
5. When you execute the trade, MetaMask will pop up asking for confirmation to record the trade hash permanently to the Sepolia blockchain!
