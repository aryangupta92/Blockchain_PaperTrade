// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title TradeRegistry
 * @notice Optional EVM anchoring contract for immutable verification of
 *         executed trades and daily Merkle roots from both DEMO and REAL accounts.
 */
contract TradeRegistry {
    struct Anchor {
        bytes32 payloadHash;
        bytes32 merkleRoot;
        uint256 blockIndex;
        uint256 timestamp;
        address submitter;
        string accountMode; // "DEMO" or "REAL"
    }

    address public owner;
    mapping(bytes32 => Anchor) public anchors;
    bytes32[] public anchorIds;

    event RecordAnchored(
        bytes32 indexed recordId,
        bytes32 indexed payloadHash,
        bytes32 merkleRoot,
        uint256 blockIndex,
        string accountMode,
        uint256 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "TradeRegistry: unauthorized");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function anchorRecord(
        bytes32 recordId,
        bytes32 payloadHash,
        bytes32 merkleRoot,
        uint256 blockIndex,
        string calldata accountMode
    ) external onlyOwner {
        require(anchors[recordId].timestamp == 0, "TradeRegistry: already anchored");
        anchors[recordId] = Anchor({
            payloadHash: payloadHash,
            merkleRoot: merkleRoot,
            blockIndex: blockIndex,
            timestamp: block.timestamp,
            submitter: msg.sender,
            accountMode: accountMode
        });
        anchorIds.push(recordId);
        emit RecordAnchored(recordId, payloadHash, merkleRoot, blockIndex, accountMode, block.timestamp);
    }

    function verifyRecord(bytes32 recordId, bytes32 expectedHash) external view returns (bool) {
        Anchor memory a = anchors[recordId];
        return a.timestamp != 0 && a.payloadHash == expectedHash;
    }

    function totalAnchors() external view returns (uint256) {
        return anchorIds.length;
    }
}
