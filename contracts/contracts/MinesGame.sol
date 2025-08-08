// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MinesGame {
    struct Game {
        address player;
        uint256 betAmount;
        uint8 totalMines;
        uint8 revealedSafeTiles;
        bool[] revealedTiles;
        uint8[] mineLocations;
        bool isActive;
    }

    mapping(address => Game) public games;
    uint256 public sharedPoolBalance;

    event GameStarted(address indexed player, uint256 betAmount, uint8 mineCount);
    event TileRevealed(address indexed player, uint8 tileIndex, bool isMine);
    event GameWon(address indexed player, uint256 winnings);
    event GameLost(address indexed player);

    // Empty constructor - no initialization needed
    constructor() {}

    function startGame(uint8 numberOfMines) external payable {
        require(msg.value > 0, "Bet amount must be greater than 0");
        require(numberOfMines >= 1 && numberOfMines <= 24, "Mines must be between 1 and 24");
        require(!games[msg.sender].isActive, "Player already has an active game");

        // Generate mine locations using block data (for development - not secure for production)
        uint8[] memory mineLocations = new uint8[](numberOfMines);
        bool[] memory revealedTiles = new bool[](25);
        
        for (uint8 i = 0; i < numberOfMines; i++) {
            uint8 mineLocation;
            bool locationValid;
            
            do {
                locationValid = true;
                mineLocation = uint8(uint256(keccak256(abi.encodePacked(
                    block.timestamp,
                    msg.sender,
                    i
                ))) % 25);
                
                // Check if this location is already taken
                for (uint8 j = 0; j < i; j++) {
                    if (mineLocations[j] == mineLocation) {
                        locationValid = false;
                        break;
                    }
                }
            } while (!locationValid);
            
            mineLocations[i] = mineLocation;
        }

        games[msg.sender] = Game({
            player: msg.sender,
            betAmount: msg.value,
            totalMines: numberOfMines,
            revealedSafeTiles: 0,
            revealedTiles: revealedTiles,
            mineLocations: mineLocations,
            isActive: true
        });

        sharedPoolBalance += msg.value;
        emit GameStarted(msg.sender, msg.value, numberOfMines);
    }

    function revealTile(uint8 tileIndex) external {
        require(tileIndex < 25, "Invalid tile index");
        require(games[msg.sender].isActive, "No active game");
        require(!games[msg.sender].revealedTiles[tileIndex], "Tile already revealed");

        Game storage game = games[msg.sender];
        game.revealedTiles[tileIndex] = true;

        // Check if this tile is a mine
        bool isMine = false;
        for (uint8 i = 0; i < game.totalMines; i++) {
            if (game.mineLocations[i] == tileIndex) {
                isMine = true;
                break;
            }
        }

        if (isMine) {
            // Game over - player loses
            game.isActive = false;
            emit TileRevealed(msg.sender, tileIndex, true);
            emit GameLost(msg.sender);
        } else {
            // Safe tile - continue game
            game.revealedSafeTiles++;
            emit TileRevealed(msg.sender, tileIndex, false);
        }
    }

    function cashOut() external {
        Game storage game = games[msg.sender];
        require(game.isActive, "No active game");
        require(game.revealedSafeTiles > 0, "Must reveal at least one safe tile");

        uint256 winnings = calculateWinnings(game.betAmount, game.totalMines, game.revealedSafeTiles);
        
        // Check if house can pay
        if (winnings + game.betAmount > sharedPoolBalance) {
            winnings = sharedPoolBalance - game.betAmount;
        }

        game.isActive = false;
        sharedPoolBalance -= (game.betAmount + winnings);

        // Transfer winnings to player
        payable(msg.sender).transfer(game.betAmount + winnings);
        
        emit GameWon(msg.sender, winnings);
    }

    function calculateWinnings(uint256 betAmount, uint8 totalMines, uint8 revealedSafeTiles) public pure returns (uint256) {
        if (revealedSafeTiles == 0) return 0;
        
        // Calculate multiplier based on mine count and revealed tiles
        // This is a simplified calculation - can be made more complex
        uint256 multiplier = (25 - totalMines) * revealedSafeTiles / 25;
        return (betAmount * multiplier) / 100;
    }

    function getGameStatus(address player) external view returns (Game memory) {
        return games[player];
    }

    function getSharedPoolBalance() external view returns (uint256) {
        return sharedPoolBalance;
    }

    // Emergency function to add funds to the house (for testing)
    function addHouseFunds() external payable {
        sharedPoolBalance += msg.value;
    }

    // Emergency function to withdraw house funds (owner only - for testing)
    function withdrawHouseFunds() external {
        // In production, this should have proper access control
        payable(msg.sender).transfer(sharedPoolBalance);
        sharedPoolBalance = 0;
    }
} 