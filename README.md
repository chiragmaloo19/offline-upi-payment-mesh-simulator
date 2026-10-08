# Offline UPI Payment Mesh Simulator

A MERN-based simulation of offline UPI payment propagation through an encrypted device mesh and internet bridge.

> **Note:** This is a conceptual prototype/simulation. It does **not** contain real UPI integration, real banking infrastructure, real Bluetooth mesh networking, or blockchain. It simulates how an offline digital payment system could securely propagate transaction data without an internet connection using local device-to-device gossip.

## Overview
This project demonstrates a theoretical architecture for offline digital payments. The architecture solves the problem of initiating a payment in a completely disconnected environment (e.g., remote areas, underground transit) by encrypting the payment instruction on the sender's device, passing it via a mesh network (simulated here) to nearby devices, and eventually reaching an internet-connected "bridge" device that forwards it to the central server for settlement.

### Key Features
- **Cryptography Layer:** Uses a hybrid RSA-2048 (OAEP-SHA256) and AES-256-GCM scheme. The central server holds the private key; devices hold the public key.
- **Mesh Simulator:** Simulates a local network of devices (nodes) using an in-memory gossip protocol. Packets propagate hop-by-hop with a configurable Time-To-Live (TTL).
- **Idempotency Protection:** Prevents replay attacks and duplicate settlements of the same packet reaching the bridge multiple times via different mesh routes.
- **Transaction Settlement:** Handles sender balance deductions, receiver balance additions, and atomic transactions using MongoDB.
- **Interactive Dashboard:** A React-based UI to visualize the mesh network, trace packet propagation, and view simulated account balances in real-time.

## Architecture & Complete Payment Flow
1. **Create Payment:** The sender initiates a payment. A JSON instruction is created containing sender VPA, receiver VPA, amount, SHA-256 hashed PIN, a unique nonce, and timestamp.
2. **Encrypt Packet:** The instruction is encrypted using a randomly generated AES-256-GCM session key. The session key is then encrypted using the server's public RSA key. Both are bundled into a `MeshPacket`.
3. **Mesh Gossip:** The packet is injected into the sender's simulated offline device. When devices "gossip," they exchange packets until the TTL expires or they reach an internet-connected bridge.
4. **Internet Bridge:** Once a packet hits a bridge node, the bridge uploads it to the central backend.
5. **Decrypt & Verify:** The backend calculates a SHA-256 hash of the ciphertext to check idempotency. If new, it decrypts the AES key using its RSA private key, then decrypts the instruction. The packet's freshness (timestamp) is validated.
6. **Settle Transaction:** If the PIN is correct and funds are sufficient, the backend updates account balances in MongoDB and records the transaction as `SETTLED`.

## Tech Stack
- **Frontend:** React, Vite, CSS (Vanilla)
- **Backend:** Node.js, Express.js
- **Database:** MongoDB, Mongoose
- **Testing:** Jest, Supertest
- **Cryptography:** Node.js native `crypto` module

## Project Structure
```text
upi-mern/
├── backend/
│   ├── src/
│   │   ├── config/       # MongoDB connection
│   │   ├── models/       # Account, Transaction schemas
│   │   ├── routes/       # Express API routes
│   │   └── services/     # Crypto, Idempotency, Settlement, Mesh
│   └── tests/            # Jest test suites
└── frontend/
    ├── src/
    │   ├── components/   # React components (Dashboard UI, Mesh Visualizer)
    │   ├── services/     # API fetch wrappers
    │   └── pages/        # Main Dashboard view
    └── index.html
```

## How to Run Locally

### Prerequisites
- Node.js (v18+)
- MongoDB (running locally on port 27017)

### 1. Backend Setup
```bash
cd backend
npm install
cp .env.example .env
npm run start
```
*Note: The backend will automatically seed 4 demo accounts (Alice, Bob, Stranger 1, Stranger 2) if the database is empty.*

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

## Running Tests
The backend contains a comprehensive test suite covering the entire pipeline.
```bash
cd backend
npm test
```

## Limitations & Future Improvements
- **Simulation Only:** The mesh network is simulated entirely in server memory rather than via real Bluetooth Low Energy (BLE) or Wi-Fi Direct.
- **In-Memory Idempotency:** The idempotency cache uses an in-memory Map. In a distributed production environment, this would require a system like Redis.
- **Static Key Management:** The server public key is fetched over an API. A real offline system would require secure pre-provisioning of public keys in the mobile app bundle or a PKI infrastructure.
