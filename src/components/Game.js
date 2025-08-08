import React, { useState, useEffect, useCallback } from 'react';
import {
  getAccount, getContractWithSigner, getProvider,
  readGameStatus, getWalletBalance, calculateCurrentWinnings, getSharedPoolBalance,
  switchToSomniaTestnet
} from '../config';
import { ethers } from 'ethers';

const GRID_SIZE = 25;
const GRID_COLS = 5;

const calculateMultiplier = (mines, safeTiles) => {
  if (safeTiles === 0) return 1;
  
  const totalTiles = 25;
  const safeTilesRemaining = totalTiles - mines;
  
  let probability = 1;
  for (let i = 0; i < safeTiles; i++) {
    probability *= (safeTilesRemaining - i) / (totalTiles - i);
  }
  
  return probability > 0 ? 1 / probability : 1;
};

function Game() {
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

  const connectWallet = async () => {
    try {
      setError(null);
      const account = await getAccount();
      if (account) {
        setAccount(account);
        try {
          await switchToSomniaTestnet();
        } catch (networkError) {
          console.log('Network switch failed, continuing with current network');
        }
        await fetchAndUpdateState(account);
      }
    } catch (err) {
      setError("Failed to connect wallet: " + (err?.reason || err?.message || err));
    }
  };

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
      
      const estimatedGas = await contract.startGame.estimateGas(mineCount, { value: valueInWei });
      console.log('Estimated gas:', estimatedGas.toString());
      const gasLimit = (estimatedGas * 12n) / 10n;
      const tx = await contract.startGame(mineCount, { 
        value: valueInWei,
        gasLimit
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

      <div className="w-full max-w-7xl flex flex-col lg:flex-row gap-8 items-center justify-center px-6">
        <aside className="w-full max-w-xl bg-gradient-to-b from-[#232b39]/90 to-[#1a1f2a]/90 backdrop-blur-sm rounded-3xl shadow-2xl p-5 flex flex-col h-[700px] border border-[#3d4656]/50">
          <div className="flex flex-col gap-4 flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gradient-to-r from-[#181f2a]/80 to-[#232b39]/80 backdrop-blur-sm rounded-2xl p-3 border border-[#3d4656]/50 shadow-lg">
                {account ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-gray-300 text-sm font-medium">💼 Wallet</div>
                      <div className="text-green-400 text-xs font-semibold">Connected</div>
                    </div>
                    <div className="bg-[#0f1419]/60 backdrop-blur-sm rounded-xl p-2 border border-[#3d4656]/30">
                      <div className="text-gray-400 text-xs mb-1">Address</div>
                      <div className="text-white text-sm font-mono mb-2">{account.slice(0, 6)}...{account.slice(-4)}</div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400 text-xs">Balance</span>
                        <span className="text-green-400 text-base font-bold">{parseFloat(walletBalance).toFixed(4)} STT</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button 
                    onClick={connectWallet}
                    className="w-full bg-gradient-to-r from-[#7fff6a] to-[#aaff99] hover:from-[#aaff99] hover:to-[#7fff6a] text-[#181f2a] font-bold rounded-2xl py-3 text-lg transition-all duration-150 shadow-lg"
                  >
                    🔗 Connect Wallet
                  </button>
                )}
              </div>

              <div className="bg-[#181f2a]/40 backdrop-blur-sm rounded-2xl p-3 border border-[#3d4656]/30">
                <label className="block text-gray-200 text-sm mb-2 font-medium">💰 Bet Amount</label>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="number"
                    value={betAmount}
                    onChange={e => setBetAmount(e.target.value)}
                    disabled={game?.isActive || loading}
                    className="flex-1 bg-[#0f1419]/80 backdrop-blur-sm border border-[#3d4656]/50 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400/50 disabled:opacity-50"
                    min="0"
                    step="0.00000001"
                    style={{ width: 'calc(100% - 60px)' }}
                  />
                  <span className="text-yellow-400 text-sm font-semibold bg-[#0f1419]/80 backdrop-blur-sm border border-[#3d4656]/50 rounded-xl px-3 py-2 whitespace-nowrap">STT</span>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setBetAmount((parseFloat(betAmount) / 2).toString())}
                    className="flex-1 bg-[#232b39]/60 backdrop-blur-sm text-gray-300 rounded-xl py-1 text-xs hover:text-white hover:bg-[#2d3646]/60 border border-[#3d4656]/30 transition-all"
                  >
                    ½
                  </button>
                  <button 
                    onClick={() => setBetAmount((parseFloat(betAmount) * 2).toString())}
                    className="flex-1 bg-[#232b39]/60 backdrop-blur-sm text-gray-300 rounded-xl py-1 text-xs hover:text-white hover:bg-[#2d3646]/60 border border-[#3d4656]/30 transition-all"
                  >
                    2x
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#181f2a]/40 backdrop-blur-sm rounded-2xl p-3 border border-[#3d4656]/30">
                <label className="block text-gray-200 text-sm mb-2 font-medium">💣 Mines</label>
                <select
                  value={mineCount}
                  onChange={e => setMineCount(Number(e.target.value))}
                  disabled={game?.isActive || loading}
                  className="w-full bg-[#0f1419]/80 backdrop-blur-sm border border-[#3d4656]/50 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400/50 disabled:opacity-50 mb-3"
                >
                  {Array.from({ length: 24 }, (_, i) => i + 1).map(num => (
                    <option key={num} value={num}>{num}</option>
                  ))}
                </select>
                
                <div className="bg-[#0f1419]/60 backdrop-blur-sm rounded-xl p-2 border border-[#3d4656]/30">
                  <div className="text-gray-200 text-xs mb-2 font-medium">📊 Multipliers</div>
                  <div className="space-y-1 text-xs">
                    <div className="grid grid-cols-3 gap-2 text-gray-200 font-medium">
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

              <div className="bg-[#181f2a]/40 backdrop-blur-sm rounded-2xl p-3 border border-[#3d4656]/30">
                <div className="text-gray-200 text-sm mb-2 font-medium">📈 Game Stats</div>
                {game ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300">Bet:</span>
                      <span className="text-white font-semibold">{ethers.formatEther(game.betAmount)} STT</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300">Mines:</span>
                      <span className="text-red-400 font-semibold">{game.totalMines}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300">Safe:</span>
                      <span className="text-green-400 font-semibold">{game.revealedSafeTiles}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300">Profit:</span>
                      <span className="text-yellow-400 font-semibold">{ethers.formatEther(liveProfit)} STT</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-400 text-sm text-center py-4">
                    No active game
                  </div>
                )}
              </div>
            </div>

            <div className="flex bg-[#2d3646]/60 backdrop-blur-sm rounded-xl p-1 border border-[#3d4656]/30">
              <button className="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-[#232b39] to-[#2d3646]">Manual</button>
              <button className="flex-1 py-2 rounded-lg text-sm font-semibold text-gray-400 hover:text-white">Auto</button>
            </div>
          </div>

          <div className="mt-3 flex-shrink-0 space-y-2">
            {game && game.revealedSafeTiles > 0 && (
              <button 
                onClick={onCashOut}
                disabled={loading}
                className="w-full bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-[#181f2a] font-bold rounded-2xl py-3 text-base transition-all duration-150 shadow-lg"
              >
                {loading ? 'Cashing Out...' : '💰 Cash Out'} 
              </button>
            )}
            <button 
              onClick={onStartGame}
              disabled={!account || game?.isActive || loading}
              className="w-full bg-gradient-to-r from-[#7fff6a] to-[#aaff99] hover:from-[#aaff99] hover:to-[#7fff6a] disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-[#181f2a] font-bold rounded-2xl py-3 text-lg transition-all duration-150 shadow-lg"
            >
              {loading ? 'Starting...' : '🎯 Bet'} 
            </button>
          </div>
        </aside>

        <main className="flex-1 flex flex-col items-center justify-center min-h-[700px]">
          <div className="bg-gradient-to-br from-[#232b39]/90 to-[#1a1f2a]/90 backdrop-blur-sm rounded-3xl shadow-2xl p-12 flex flex-col items-center justify-center border border-[#3d4656]/50 relative overflow-hidden w-full max-w-4xl">
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent rounded-3xl pointer-events-none"></div>
            
            <div className="text-center mb-10">
              <h1 className="text-4xl font-bold text-white mb-3">🎮 mineSomnia</h1>
              <p className="text-gray-400 text-lg">Find the gems, avoid the mines!</p>
            </div>

            <div className="grid grid-cols-5 gap-4 relative z-10 mb-8">
              {Array.from({ length: GRID_SIZE }).map((_, i) => (
                <div
                  key={i}
                  onClick={() => !game?.isActive ? null : onRevealTile(i)}
                  className={`w-24 h-24 rounded-2xl flex items-center justify-center border-2 shadow-xl transition-all duration-300 text-3xl backdrop-blur-sm relative overflow-hidden hover:scale-105 ${getTileStyle(i)}`}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent rounded-2xl pointer-events-none"></div>
                  <div className="relative z-10">
                    {renderTileContent(i)}
                  </div>
                </div>
              ))}
            </div>
            
            {game && game.revealedSafeTiles > 0 && (
              <div className="w-full bg-gradient-to-r from-[#2d3646]/80 to-[#232b39]/80 backdrop-blur-sm rounded-3xl p-8 border border-[#3d4656]/50 shadow-xl relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent rounded-3xl pointer-events-none"></div>
                <div className="text-center relative z-10">
                  <div className="text-gray-200 text-lg mb-4 font-medium">💰 Current Profit</div>
                  <div className="text-yellow-400 text-5xl font-bold mb-4">{ethers.formatEther(liveProfit)} STT</div>
                  <div className="bg-[#181f2a]/60 backdrop-blur-sm rounded-2xl p-6 border border-[#3d4656]/30">
                    <div className="text-green-400 text-lg font-semibold mb-3">
                      🎯 {game.revealedSafeTiles} safe tiles revealed
                    </div>
                    <div className="text-gray-300 text-base">
                      Keep going to increase your winnings! 🚀
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default Game;