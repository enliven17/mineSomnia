import React, { useState, useEffect, useCallback } from 'react';
import {
  getAccount, getContractWithSigner, getProvider,
  readGameStatus, getWalletBalance, calculateCurrentWinnings, getSharedPoolBalance,
  switchToSomniaTestnet
} from '../config';
import { ethers } from 'ethers';

const GRID_SIZE = 25;
const GRID_COLS = 5;

// Calculate multiplier based on mines and safe tiles
const calculateMultiplier = (mines, safeTiles) => {
  if (safeTiles === 0) return 1;
  
  // Calculate probability of hitting safe tiles consecutively
  const totalTiles = 25;
  const safeTilesRemaining = totalTiles - mines;
  
  let probability = 1;
  for (let i = 0; i < safeTiles; i++) {
    probability *= (safeTilesRemaining - i) / (totalTiles - i);
  }
  
  // Return the inverse of probability as multiplier
  return probability > 0 ? 1 / probability : 1;
};

function Game() {
  // State
  const [account, setAccount] = useState(null);
  const [walletBalance, setWalletBalance] = useState('0');
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(false);
  const [liveProfit, setLiveProfit] = useState('0');
  const [betAmount, setBetAmount] = useState('0.1');
  const [mineCount, setMineCount] = useState(3);
  const [pendingTile, setPendingTile] = useState(null);
  const [error, setError] = useState(null);
  const [modalState, setModalState] = useState({ isOpen: false, isWin: false, amount: '0' });

  // Fetch game state
  const fetchAndUpdateState = useCallback(async (acc) => {
    if (!acc) return;
    try {
      const [walletBal, status, poolBalanceBN] = await Promise.all([
        getWalletBalance(acc),
        readGameStatus(acc),
        getSharedPoolBalance()
      ]);

      setWalletBalance(walletBal);

      if (status && status.isActive) {
        setGame(status);
        const theoreticalProfitBN = await calculateCurrentWinnings(status);
        const betAmountBN = window.BigInt(status.betAmount);
        const theoreticalPayoutBN = betAmountBN + theoreticalProfitBN;
        
        let actualPayoutBN;
        const effectivePoolBalance = poolBalanceBN - betAmountBN;

        if (theoreticalPayoutBN > effectivePoolBalance) {
          actualPayoutBN = effectivePoolBalance;
        } else {
          actualPayoutBN = theoreticalPayoutBN;
        }
        
        let actualProfitBN = actualPayoutBN - betAmountBN;
        if (actualProfitBN < 0n) {
          actualProfitBN = 0n;
        }
        
        setLiveProfit(actualProfitBN.toString());
      } else {
        setGame(null);
        setLiveProfit('0');
      }
      return status;
    } catch (err) {
      console.error("Error fetching wallet data:", err);
    }
  }, []);

  // Connect wallet
  const connectWallet = async () => {
    try {
      setError(null);
      const account = await getAccount();
      if (account) {
        setAccount(account);
        // Try to switch to Hardhat network
        try {
          await switchToSomniaTestnet(); // This now switches to Hardhat
        } catch (networkError) {
          console.log('Network switch failed, continuing with current network');
        }
        await fetchAndUpdateState(account);
      }
    } catch (err) {
      setError("Failed to connect wallet: " + (err?.reason || err?.message || err));
    }
  };

  // Start game
  const onStartGame = async () => {
    if (!account) return;
    setLoading(true);
    setError(null);
    try {
      console.log('Starting game with:', { mineCount, betAmount, account });
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error('No contract instance available');
      
      console.log('Contract address:', await contract.getAddress());
      const valueInWei = ethers.parseEther(betAmount);
      console.log('Parsed bet amount:', valueInWei.toString());
      
      // Create transaction with explicit value
      const tx = await contract.startGame(mineCount, { 
        value: valueInWei,
        gasLimit: 500000 // Add explicit gas limit
      });
      console.log('Transaction sent:', tx.hash);
      
      await tx.wait();
      console.log('Transaction confirmed');
      
      await fetchAndUpdateState(account);
    } catch (err) {
      console.error('Start game error:', err);
      setError("Start game failed: " + (err?.reason || err?.message || err));
      setGame(null);
    } finally {
      setLoading(false);
    }
  };

  // Reveal tile
  const onRevealTile = async (index) => {
    if (!game?.isActive || loading || pendingTile !== null) return;
    setPendingTile(index);
    setError(null);
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error('No contract instance available');
      
      const tx = await contract.revealTile(index);
      await tx.wait();
      const newStatus = await fetchAndUpdateState(account);
      if (!newStatus || !newStatus.isActive) {
        setModalState({ isOpen: true, isWin: false, amount: '0' });
      }
    } catch (err) {
      setError("Reveal failed: " + (err?.reason || err?.message || err));
    } finally {
      setPendingTile(null);
    }
  };

  // Cash out
  const onCashOut = async () => {
    if (!game || game.revealedSafeTiles === 0) return;
    setLoading(true);
    setError(null);
    const expectedPayout = (window.BigInt(game.betAmount) + window.BigInt(liveProfit)).toString();
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error('No contract instance available');
      
      const tx = await contract.cashOut();
      await tx.wait();
      await fetchAndUpdateState(account);
      setModalState({ isOpen: true, isWin: true, amount: expectedPayout });
    } catch (err) {
      setError("Cashout failed: " + (err?.reason || err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  // Auto connect on load
  useEffect(() => {
    if (typeof window !== 'undefined' && window.ethereum) {
      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          fetchAndUpdateState(accounts[0]);
        } else {
          setAccount(null);
          setGame(null);
        }
      });
    }
  }, [fetchAndUpdateState]);

  // Render tile content
  const renderTileContent = (index) => {
    if (!game) return null;
    
    if (pendingTile === index) {
      return <div className="w-6 h-6 border-2 border-t-green-400 border-gray-600 rounded-full animate-spin"></div>;
    }
    
    if (game.revealedTiles[index]) {
      if (game.mineLocations.includes(index)) {
        return <span className="text-3xl">💥</span>;
      } else {
        return <span className="text-3xl">💎</span>;
      }
    }
    
    return null;
  };

  // Get tile styling
  const getTileStyle = (index) => {
    if (!game) {
      return "bg-[#181f2a] border-[#232b39] text-green-400 hover:bg-[#222b38]";
    }
    
    if (pendingTile === index) {
      return "bg-[#2d3646] border-green-400 text-green-400";
    }
    
    if (game.revealedTiles[index]) {
      if (game.mineLocations.includes(index)) {
        return "bg-red-900 border-red-600 text-red-400 animate-pulse";
      } else {
        return "bg-green-900 border-green-600 text-green-400";
      }
    }
    
    return "bg-[#181f2a] border-[#232b39] text-green-400 hover:bg-[#222b38] cursor-pointer";
  };

  return (
    <div className="min-h-screen w-full bg-[#181f2a] flex items-center justify-center py-8">
      {/* Error Modal */}
      {error && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg">
          {error}
          <button 
            onClick={() => setError(null)}
            className="ml-4 text-white hover:text-gray-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Win/Lose Modal */}
      {modalState.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#232b39] text-white rounded-2xl p-8 text-center">
            <div className="text-6xl mb-4">
              {modalState.isWin ? '🎉' : '💥'}
            </div>
            <h2 className="text-2xl font-bold mb-4">
              {modalState.isWin ? 'Congratulations!' : 'Game Over!'}
            </h2>
            <p className="mb-6">
              {modalState.isWin 
                ? `You won ${ethers.formatEther(modalState.amount)} STT!`
                : 'Better luck next time!'
              }
            </p>
            <button
              onClick={() => setModalState({ isOpen: false, isWin: false, amount: '0' })}
              className="bg-[#7fff6a] text-[#181f2a] px-6 py-2 rounded-lg font-bold"
            >
              {modalState.isWin ? 'Play Again' : 'Try Again'}
            </button>
          </div>
        </div>
      )}

      <div className="w-full max-w-7xl flex flex-col lg:flex-row gap-16 items-center justify-center">
        {/* Sidebar - Settings */}
        <aside className="w-full max-w-md bg-[#232b39] rounded-2xl shadow-2xl p-8 flex flex-col justify-between h-[700px]">
          <div className="flex flex-col gap-6">
            {/* Wallet Info */}
            {account ? (
              <div className="mx-auto w-64 h-20 flex flex-col justify-center items-center bg-[#181f2a] rounded-lg border border-[#2d3646] mb-2">
                <div className="text-gray-400 text-xs font-medium">Wallet</div>
                <div className="text-white text-sm font-mono">{account.slice(0, 6)}...{account.slice(-4)}</div>
                <div className="text-green-400 text-sm font-semibold">{parseFloat(walletBalance).toFixed(4)} STT</div>
              </div>
            ) : (
              <button 
                onClick={connectWallet}
                className="w-full bg-[#7fff6a] hover:bg-[#aaff99] text-[#181f2a] font-bold rounded-lg py-4 text-lg transition-all duration-150 shadow-lg"
              >
                Connect Wallet
              </button>
            )}

            {/* Toggle Bar */}
            <div className="flex bg-[#2d3646] rounded-xl p-1">
              <button className="flex-1 py-3 rounded-lg text-sm font-semibold text-white bg-[#232b39]">Manual</button>
              <button className="flex-1 py-3 rounded-lg text-sm font-semibold text-gray-400 hover:text-white">Auto</button>
            </div>

            {/* Bet Amount */}
            <div>
              <label className="block text-gray-400 text-xs mb-2">Bet Amount</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={betAmount}
                  onChange={e => setBetAmount(e.target.value)}
                  disabled={game?.isActive || loading}
                  className="flex-1 bg-[#181f2a] border border-[#232b39] text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 disabled:opacity-50"
                  min="0"
                  step="0.00000001"
                />
                <span className="text-yellow-400 text-lg">🪙</span>
              </div>
              <div className="flex gap-2 mt-3">
                <button 
                  onClick={() => setBetAmount((parseFloat(betAmount) / 2).toString())}
                  className="flex-1 bg-[#232b39] text-gray-400 rounded-md py-2 text-xs hover:text-white"
                >
                  ½
                </button>
                <button 
                  onClick={() => setBetAmount((parseFloat(betAmount) * 2).toString())}
                  className="flex-1 bg-[#232b39] text-gray-400 rounded-md py-2 text-xs hover:text-white"
                >
                  2x
                </button>
              </div>
            </div>

            {/* Mines */}
            <div>
              <label className="block text-gray-400 text-xs mb-2">Mines</label>
              <select
                value={mineCount}
                onChange={e => setMineCount(Number(e.target.value))}
                disabled={game?.isActive || loading}
                className="w-full bg-[#181f2a] border border-[#232b39] text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 disabled:opacity-50"
              >
                {Array.from({ length: 24 }, (_, i) => i + 1).map(num => (
                  <option key={num} value={num}>{num}</option>
                ))}
              </select>
              
              {/* Multiplier Table */}
              <div className="mt-4 bg-[#181f2a] rounded-lg p-3">
                <div className="text-gray-400 text-xs mb-2">Multipliers</div>
                <div className="space-y-1 text-xs">
                  <div className="grid grid-cols-3 gap-2 text-gray-300 font-medium">
                    <span>Mines</span>
                    <span className="text-center">Safe</span>
                    <span className="text-right">Multiplier</span>
                  </div>
                  {[1, 2, 3, 4, 5].map(safeCount => {
                    const multiplier = calculateMultiplier(mineCount, safeCount);
                    return (
                      <div key={safeCount} className="grid grid-cols-3 gap-2">
                        <span className="text-red-400">{mineCount}</span>
                        <span className="text-green-400 text-center">{safeCount}</span>
                        <span className="text-yellow-400 text-right">{multiplier.toFixed(2)}x</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Game Stats */}
            {game && (
              <div className="bg-[#181f2a] rounded-lg p-4">
                <div className="text-gray-400 text-xs mb-3">Game Stats</div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Bet:</span>
                    <span className="text-white">{ethers.formatEther(game.betAmount)} STT</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Mines:</span>
                    <span className="text-red-400">{game.totalMines}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Safe:</span>
                    <span className="text-green-400">{game.revealedSafeTiles}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Profit:</span>
                    <span className="text-yellow-400">{ethers.formatEther(liveProfit)} STT</span>
                  </div>
                </div>
                {game.revealedSafeTiles > 0 && (
                  <button 
                    onClick={onCashOut}
                    disabled={loading}
                    className="w-full mt-4 bg-yellow-500 hover:bg-yellow-600 text-[#181f2a] font-bold rounded-lg py-3 text-sm transition-all duration-150"
                  >
                    {loading ? 'Cashing Out...' : 'Cash Out'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Bet Button - Bottom */}
          <div className="mt-6">
            <button 
              onClick={onStartGame}
              disabled={!account || game?.isActive || loading}
              className="w-full bg-[#7fff6a] hover:bg-[#aaff99] disabled:bg-gray-600 disabled:cursor-not-allowed text-[#181f2a] font-bold rounded-lg py-4 text-lg transition-all duration-150 shadow-lg"
            >
              {loading ? 'Starting...' : 'Bet'}
            </button>
          </div>
        </aside>

        {/* Main Grid */}
        <main className="flex-1 flex flex-col items-center justify-center">
          <div className="bg-[#232b39] rounded-3xl shadow-2xl p-12 flex flex-col items-center justify-center">
            <div className="grid grid-cols-5 gap-8">
              {Array.from({ length: GRID_SIZE }).map((_, i) => (
                <div
                  key={i}
                  onClick={() => !game?.isActive ? null : onRevealTile(i)}
                  className={`w-32 h-32 rounded-2xl flex items-center justify-center border-2 shadow-md transition-all duration-150 text-5xl ${getTileStyle(i)}`}
                >
                  {renderTileContent(i)}
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default Game;