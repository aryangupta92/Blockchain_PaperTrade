// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title BlockTrade
 * @dev Smart Contract to record paper trades and subscriptions on-chain permanently.
 * Designed for deployment on Sepolia Testnet.
 */
contract BlockTrade {
    address public owner;

    // Fixed Subscription Costs (in WEI for demo purposes, these are very small)
    // 0.001 ETH = ~3 USD
    uint256 public constant PLAN_STARTER_COST = 0.001 ether; 
    uint256 public constant PLAN_PRO_COST = 0.005 ether;
    uint256 public constant PLAN_EXPERT_COST = 0.01 ether;

    struct UserData {
        string name;
        string email;
        string planId;
        uint256 virtualBalance;
        bool isRegistered;
    }

    struct Trade {
        string symbol;
        uint256 quantity;
        uint256 price; // Scaled up (e.g. 24000.50 * 100 = 2400050)
        string side; // "BUY" or "SELL"
        string localBlockHash; // The SHA-256 hash from the Node.js backend
        uint256 timestamp;
    }

    mapping(address => UserData) public users;
    mapping(address => Trade[]) private userTrades;

    event UserRegistered(address indexed userWallet, string name, string email);
    event SubscriptionPurchased(address indexed userWallet, string planId, uint256 amountPaid);
    event TradeRecorded(address indexed userWallet, string symbol, string side, uint256 quantity, uint256 price, string blockHash, uint256 timestamp);

    constructor() {
        owner = msg.sender;
    }

    // 1. Register User (Free)
    function registerUser(string memory _name, string memory _email) public {
        require(!users[msg.sender].isRegistered, "User already registered");
        users[msg.sender] = UserData({
            name: _name,
            email: _email,
            planId: "FREE",
            virtualBalance: 0,
            isRegistered: true
        });
        emit UserRegistered(msg.sender, _name, _email);
    }

    // 2. Buy Subscription with Fake ETH
    function purchaseSubscription(string memory _planId) public payable {
        require(users[msg.sender].isRegistered, "Must register first");
        
        uint256 requiredCost = 0;
        uint256 addedCapital = 0;

        // Note: Keccak256 is used to compare strings in Solidity
        if (keccak256(abi.encodePacked(_planId)) == keccak256(abi.encodePacked("starter"))) {
            requiredCost = PLAN_STARTER_COST;
            addedCapital = 50000;
        } else if (keccak256(abi.encodePacked(_planId)) == keccak256(abi.encodePacked("pro"))) {
            requiredCost = PLAN_PRO_COST;
            addedCapital = 200000;
        } else if (keccak256(abi.encodePacked(_planId)) == keccak256(abi.encodePacked("expert"))) {
            requiredCost = PLAN_EXPERT_COST;
            addedCapital = 1000000;
        } else {
            revert("Invalid plan specified");
        }

        require(msg.value >= requiredCost, "Insufficient ETH provided for this plan");

        // Refund excess ETH if they paid more than required
        if (msg.value > requiredCost) {
            payable(msg.sender).transfer(msg.value - requiredCost);
        }

        users[msg.sender].planId = _planId;
        users[msg.sender].virtualBalance += addedCapital;

        emit SubscriptionPurchased(msg.sender, _planId, requiredCost);
    }

    // 3. Record Paper Trade 
    function recordTrade(
        string memory _symbol, 
        uint256 _quantity, 
        uint256 _priceTimes100, // Pass price * 100 to avoid decimals in solidity
        string memory _side,
        string memory _localBlockHash
    ) public {
        require(users[msg.sender].isRegistered, "User not registered");
        require(
            keccak256(abi.encodePacked(_side)) == keccak256(abi.encodePacked("buy")) || 
            keccak256(abi.encodePacked(_side)) == keccak256(abi.encodePacked("sell")), 
            "Side must be buy or sell"
        );

        userTrades[msg.sender].push(Trade({
            symbol: _symbol,
            quantity: _quantity,
            price: _priceTimes100,
            side: _side,
            localBlockHash: _localBlockHash,
            timestamp: block.timestamp
        }));

        emit TradeRecorded(msg.sender, _symbol, _side, _quantity, _priceTimes100, _localBlockHash, block.timestamp);
    }

    // 4. Get total trades count for user
    function getUserTradeCount(address _user) public view returns (uint256) {
        return userTrades[_user].length;
    }

    // 5. Get a specific trade for a user
    function getUserTrade(address _user, uint256 _index) public view returns (Trade memory) {
        require(_index < userTrades[_user].length, "Trade index out of bounds");
        return userTrades[_user][_index];
    }

    // 6. Withdraw accumulated subscription fees (Owner Only)
    function withdrawFees() public {
        require(msg.sender == owner, "Only owner can withdraw");
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        payable(owner).transfer(balance);
    }
}
