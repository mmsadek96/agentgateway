// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title CertificateRegistry
 * @notice On-chain registry of AI agent trust certificates on Base L2.
 * @dev Certificates are the core trust artifact. Anyone can verify a certificate
 *      by calling verifyCertificate() — a free read call, no wallet needed.
 *      Only the AgentTrust operational wallet can issue or revoke certificates.
 */
contract CertificateRegistry is UUPSUpgradeable, OwnableUpgradeable {

    struct Certificate {
        bytes32 agentId;          // reference to AgentRegistry
        uint16 scoreAtIssuance;   // reputation when cert was issued (0-1000)
        bytes32 scopeHash;        // keccak256 of scope manifest JSON
        uint8 status;             // 0=valid, 1=expired, 2=revoked
        uint40 issuedAt;          // unix timestamp
        uint40 expiresAt;         // unix timestamp
        uint40 revokedAt;         // 0 if not revoked
    }

    mapping(bytes32 => Certificate) public certificates;
    mapping(bytes32 => bytes32[]) public agentCertificates;
    mapping(bytes32 => bytes32) public activeCertificate;

    uint256 public totalCertificates;
    uint256 public activeCertificateCount;

    event CertificateIssued(
        bytes32 indexed certId,
        bytes32 indexed agentId,
        uint16 scoreAtIssuance,
        bytes32 scopeHash,
        uint40 issuedAt,
        uint40 expiresAt
    );

    event CertificateRevoked(
        bytes32 indexed certId,
        bytes32 indexed agentId,
        uint40 revokedAt
    );

    event CertificateExpired(
        bytes32 indexed certId,
        bytes32 indexed agentId,
        uint40 expiredAt
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function issueCertificate(
        bytes32 certId,
        bytes32 agentId,
        uint16 scoreAtIssuance,
        bytes32 scopeHash,
        uint40 expiresAt
    ) external onlyOwner {
        require(certificates[certId].issuedAt == 0, "Cert exists");
        require(expiresAt > block.timestamp, "Already expired");

        certificates[certId] = Certificate({
            agentId: agentId,
            scoreAtIssuance: scoreAtIssuance,
            scopeHash: scopeHash,
            status: 0,
            issuedAt: uint40(block.timestamp),
            expiresAt: expiresAt,
            revokedAt: 0
        });

        agentCertificates[agentId].push(certId);

        // expire previous active cert
        bytes32 prevCert = activeCertificate[agentId];
        if (prevCert != bytes32(0) && certificates[prevCert].status == 0) {
            certificates[prevCert].status = 1;
            activeCertificateCount--;
            emit CertificateExpired(prevCert, agentId, uint40(block.timestamp));
        }

        activeCertificate[agentId] = certId;
        totalCertificates++;
        activeCertificateCount++;

        emit CertificateIssued(certId, agentId, scoreAtIssuance, scopeHash, uint40(block.timestamp), expiresAt);
    }

    function revokeCertificate(bytes32 certId) external onlyOwner {
        Certificate storage cert = certificates[certId];
        require(cert.issuedAt != 0, "Not found");
        require(cert.status == 0, "Not active");

        cert.status = 2;
        cert.revokedAt = uint40(block.timestamp);

        if (activeCertificate[cert.agentId] == certId) {
            activeCertificate[cert.agentId] = bytes32(0);
        }
        activeCertificateCount--;

        emit CertificateRevoked(certId, cert.agentId, uint40(block.timestamp));
    }

    function batchIssueCertificates(
        bytes32[] calldata certIds,
        bytes32[] calldata _agentIds,
        uint16[] calldata scores,
        bytes32[] calldata scopeHashes,
        uint40[] calldata expiries
    ) external onlyOwner {
        require(
            certIds.length == _agentIds.length &&
            certIds.length == scores.length &&
            certIds.length == scopeHashes.length &&
            certIds.length == expiries.length,
            "Length mismatch"
        );

        for (uint256 i = 0; i < certIds.length; i++) {
            if (certificates[certIds[i]].issuedAt != 0) continue;
            if (expiries[i] <= block.timestamp) continue;

            certificates[certIds[i]] = Certificate({
                agentId: _agentIds[i],
                scoreAtIssuance: scores[i],
                scopeHash: scopeHashes[i],
                status: 0,
                issuedAt: uint40(block.timestamp),
                expiresAt: expiries[i],
                revokedAt: 0
            });

            agentCertificates[_agentIds[i]].push(certIds[i]);
            activeCertificate[_agentIds[i]] = certIds[i];
            totalCertificates++;
            activeCertificateCount++;

            emit CertificateIssued(
                certIds[i], _agentIds[i], scores[i], scopeHashes[i],
                uint40(block.timestamp), expiries[i]
            );
        }
    }

    // --- Free read functions (anyone can call, no wallet needed) ---

    function verifyCertificate(bytes32 certId) external view returns (
        bool isValid,
        bytes32 agentId,
        uint16 score,
        bytes32 scopeHash
    ) {
        Certificate memory cert = certificates[certId];
        bool valid = cert.issuedAt != 0 &&
                     cert.status == 0 &&
                     block.timestamp < cert.expiresAt;
        return (valid, cert.agentId, cert.scoreAtIssuance, cert.scopeHash);
    }

    function getCertificate(bytes32 certId) external view returns (Certificate memory) {
        return certificates[certId];
    }

    function getActiveCertificate(bytes32 agentId) external view returns (bytes32) {
        return activeCertificate[agentId];
    }

    function getAgentCertificateHistory(bytes32 agentId) external view returns (bytes32[] memory) {
        return agentCertificates[agentId];
    }

    function getStats() external view returns (uint256 total, uint256 active) {
        return (totalCertificates, activeCertificateCount);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /**
     * SECURITY (#86): Storage gap for future upgrades.
     * Reserves 50 storage slots to prevent storage layout collisions when
     * adding new state variables in future implementations.
     */
    uint256[50] private __gap;
}
