import { ethers } from 'ethers';
import MinesGameContract from './MinesGame.json';

// Local Hardhat Network Configuration
export const hardhatNetwork = {
  chainId: 1337,
  name: 'Hardhat Local',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: ['http://127.0.0.1:8545']
    }
  },
  blockExplorerUrls: []
};

// Somnia Testnet Configuration
export const somniaTestnet = {
  chainId: 50312,
  name: 'Somnia Testnet',
  nativeCurrency: {
    name: 'Somnia Token',
    symbol: 'STT',
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: ['https://dream-rpc.somnia.network']
    }
  },
  blockExplorerUrls: ['https://shannon-explorer.somnia.network']
};

// Contract address - latest deployed to Somnia Testnet
const MINES_GAME_CONTRACT_ADDRESS = '0x3a8d19bedca566e04B10D829580Df4a039683b37';

// Provider and signer setup
export const getProvider = () => {
  if (typeof window !== 'undefined' && window.ethereum) {
    return new ethers.BrowserProvider(window.ethereum);
  }
  return null;
};

export const getSigner = async () => {
  const provider = getProvider();
  if (provider) {
    return await provider.getSigner();
  }
  return null;
};

// Contract instance
export const getContract = () => {
  const provider = getProvider();
  if (!provider) return null;
  
  return new ethers.Contract(
    MINES_GAME_CONTRACT_ADDRESS, 
    MinesGameContract.abi, 
    provider
  );
};

export const getContractWithSigner = async () => {
  const signer = await getSigner();
  if (!signer) return null;
  
  return new ethers.Contract(
    MINES_GAME_CONTRACT_ADDRESS, 
    MinesGameContract.abi, 
    signer
  );
};

// Account management
export const getAccount = async () => {
  if (typeof window !== 'undefined' && window.ethereum) {
    const accounts = await window.ethereum.request({ 
      method: 'eth_requestAccounts' 
    });
    return accounts[0];
  }
  return null;
};

// Balance functions
export const getWalletBalance = async (address) => {
  if (!address) return '0';
  const provider = getProvider();
  if (!provider) return '0';
  
  const balance = await provider.getBalance(address);
  return ethers.formatEther(balance);
};

// Transaction creation functions
export const createStartGameTransaction = async (numberOfMines, betAmountInEth) => {
  const contract = await getContractWithSigner();
  if (!contract) throw new Error('No contract instance available');
  
  const tx = await contract.startGame.populateTransaction(
    numberOfMines, 
    { value: ethers.parseEther(betAmountInEth) }
  );
  return tx;
};

export const createRevealTileTransaction = async (tileIndex) => {
  const contract = await getContractWithSigner();
  if (!contract) throw new Error('No contract instance available');
  
  const tx = await contract.revealTile.populateTransaction(tileIndex);
  return tx;
};

export const createCashOutTransaction = async () => {
  const contract = await getContractWithSigner();
  if (!contract) throw new Error('No contract instance available');
  
  const tx = await contract.cashOut.populateTransaction();
  return tx;
};

// Read functions
export const readGameStatus = async (playerAddress) => {
  const contract = getContract();
  if (!contract) return null;
  
  try {
    const game = await contract.getGameStatus(playerAddress);
    return {
      player: game.player,
      betAmount: game.betAmount.toString(),
      totalMines: Number(game.totalMines),
      revealedSafeTiles: Number(game.revealedSafeTiles),
      revealedTiles: game.revealedTiles,
      mineLocations: game.mineLocations.map(loc => Number(loc)),
      isActive: game.isActive,
    };
  } catch (error) {
    console.error('Error reading game status:', error);
    return null;
  }
};

export const getSharedPoolBalance = async () => {
  const contract = getContract();
  if (!contract) return 0n;
  
  try {
    const balance = await contract.getSharedPoolBalance();
    return balance;
  } catch (error) {
    console.error('Error reading shared pool balance:', error);
    return 0n;
  }
};

export const calculateCurrentWinnings = async (gameData) => {
  if (!gameData || gameData.revealedSafeTiles === 0) return 0n;
  
  const contract = getContract();
  if (!contract) return 0n;
  
  try {
    const winnings = await contract.calculateWinnings(
      gameData.betAmount,
      gameData.totalMines,
      gameData.revealedSafeTiles
    );
    return winnings;
  } catch (error) {
    console.error('Error calculating winnings:', error);
    return 0n;
  }
};

// Network switching
export const switchToSomniaTestnet = async () => {
  if (typeof window !== 'undefined' && window.ethereum) {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${somniaTestnet.chainId.toString(16)}` }],
      });
    } catch (switchError) {
      // This error code indicates that the chain has not been added to MetaMask
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [somniaTestnet],
          });
        } catch (addError) {
          console.error('Error adding Somnia Testnet to MetaMask:', addError);
        }
      }
    }
  }
};