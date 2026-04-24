import { useState, useEffect } from 'react';
import { connectWallet, getWeb3Provider } from '../../services/web3';
import { Wallet, ShieldCheck, AlertCircle } from 'lucide-react';
import { ethers } from 'ethers';
import './WalletConnect.css';

export default function WalletConnect({ onConnect }) {
  const [address, setAddress] = useState(null);
  const [balance, setBalance] = useState('0.00');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Check if already connected
  useEffect(() => {
    const checkConnection = async () => {
      if (window.ethereum) {
        try {
          const provider = getWeb3Provider();
          const accounts = await provider.send("eth_accounts", []);
          if (accounts.length > 0) {
            handleConnect(accounts[0]);
          }
        } catch (e) {
          console.error(e);
        }
      }
    };
    checkConnection();
  }, []);

  const handleConnect = async (accAddress = null) => {
    setLoading(true);
    setError('');
    try {
      const walletAddress = accAddress || await connectWallet();
      setAddress(walletAddress);
      
      // Fetch ETH balance
      const provider = getWeb3Provider();
      const bal = await provider.getBalance(walletAddress);
      setBalance(Number(ethers.formatEther(bal)).toFixed(4));
      
      if (onConnect) onConnect(walletAddress);
    } catch (err) {
      setError(err.message || 'Failed to connect MetaMask');
    } finally {
      setLoading(false);
    }
  };

  const disconnect = () => {
    setAddress(null);
    setBalance('0.00');
    if (onConnect) onConnect(null);
  };

  if (address) {
    return (
      <div className="wallet-connected" onClick={disconnect} title="Click to disconnect">
        <ShieldCheck size={14} className="gain" />
        <span className="wallet-addr">{address.substring(0,6)}...{address.substring(address.length-4)}</span>
        <span className="wallet-bal">{balance} ETH</span>
      </div>
    );
  }

  return (
    <div className="wallet-connect-wrapper">
      <button className="wallet-btn" onClick={() => handleConnect()} disabled={loading}>
        <Wallet size={14} />
        {loading ? 'Connecting...' : 'Connect MetaMask'}
      </button>
      {error && <div className="wallet-err"><AlertCircle size={10} /> {error}</div>}
    </div>
  );
}
