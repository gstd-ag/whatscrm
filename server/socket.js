// socket.js
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { query } = require("./database/dbpromise");
const { processSocketEvent } = require("./helper/socket");

let ioInstance = null;

// Database functions
async function getUserData(uid) {
  try {
    const [user] = await query("SELECT * FROM user WHERE uid = ?", [uid]);
    return user || null;
  } catch (error) {
    console.error("Error fetching user data:", error);
    throw error; // Rethrow for better error handling upstream
  }
}

async function getAgentData(uid) {
  try {
    const [agent] = await query(`SELECT * FROM agents where uid = ?`, [uid]);
    if (agent) {
      const [owner] = await query(`SELECT * FROM user where uid = ?`, [
        agent?.owner_uid,
      ]);
      return {
        ...agent,
        owner: owner || {},
      };
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error fetching agent data:", error);
    throw error;
  }
}

// ── Multi-tenant: resolve o tenant_id do socket (ADITIVO) ───────────────────
// Ordem de resolucao:
//   1) tenant_id embutido no JWT (quando o login o incluir)
//   2) linha do agente (agents.tenant_id)
//   3) vinculo ativo do dono em tenant_users (p/ agente legado, via owner_uid)
//   4) vinculo ativo do usuario em tenant_users
// Fallback: null -> socket sem sala de tenant (comportamento legado preservado).
async function resolveSocketTenantId(decoded, isAgent, userData) {
  try {
    if (decoded?.tenant_id) return decoded.tenant_id;

    if (isAgent) {
      if (userData?.tenant_id) return userData.tenant_id;
      const ownerUid = userData?.owner_uid;
      if (ownerUid) {
        const rows = await query(
          `SELECT tenant_id FROM tenant_users WHERE user_uid = ? AND is_active = 1 ORDER BY id ASC LIMIT 1`,
          [ownerUid],
        );
        if (rows && rows.length > 0) return rows[0].tenant_id;
      }
      return null;
    }

    const rows = await query(
      `SELECT tenant_id FROM tenant_users WHERE user_uid = ? AND is_active = 1 ORDER BY id ASC LIMIT 1`,
      [decoded?.uid],
    );
    if (rows && rows.length > 0) return rows[0].tenant_id;
  } catch (err) {
    // Banco legado sem tabela tenant_users -> apenas sem sala de tenant
    console.warn("[socket] tenant lookup indisponivel:", err.message);
  }
  return null;
}

// Salas por tenant: tenant_{id} | tenant_{id}_user_{uid}
function joinTenantRooms(socket, tenantId, uid, isAgent, ownerUid) {
  if (!tenantId) return;
  socket.join(`tenant_${tenantId}`);
  socket.join(`tenant_${tenantId}_user_${uid}`);
  // Paridade legada: agente tambem recebe mensagens direcionadas ao dono
  if (isAgent && ownerUid && ownerUid !== uid) {
    socket.join(`tenant_${tenantId}_user_${ownerUid}`);
  }
}

// Socket initialization
function initializeSocket(server) {
  ioInstance = new Server(server, {
    cors: {
      origin: "*", // Consider environment-based configuration
      methods: ["GET", "POST"],
    },
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
      skipMiddlewares: true,
    },
  });

  // Authentication middleware
  ioInstance.use(async (socket, next) => {
    try {
      const { token } = socket.handshake.query; // Changed from query to auth for better security

      if (!token) {
        return next(new Error("Authentication token required"));
      }

      const decoded = jwt.verify(token, process.env.JWTKEY);
      socket.decodedToken = decoded;
      next();
    } catch (error) {
      console.error("Authentication failed:", error.message);
      next(new Error("Authentication failed"));
    }
  });

  // Connection handler
  ioInstance.on("connection", async (socket) => {
    try {
      const { uid, role } = socket.decodedToken;
      const isAgent = role === "agent";

      // console.log(`New connection attempt from UID: ${uid}`);

      const userData = isAgent
        ? await getAgentData(uid)
        : await getUserData(uid);

      if (!userData) {
        throw new Error("User data not found");
      }

      // ── Multi-tenant: resolve tenant e entra nas salas (ADITIVO) ────────
      const tenantId = await resolveSocketTenantId(
        socket.decodedToken,
        isAgent,
        userData,
      );

      // Store user data on socket
      socket.userData = {
        ...userData,
        socketId: socket.id,
        isAgent,
        connectedAt: new Date(),
        tenantId: tenantId || null,
      };

      joinTenantRooms(socket, tenantId, userData.uid, isAgent, userData.owner_uid);

      // Success response
      socket.emit("connection_ack", {
        status: "success",
        socketId: socket.id,
        ...(tenantId && { tenantId }),
        userData: {
          uid: userData.uid,
          name: userData.name,
          email: userData.email,
          isAgent,
          ...(isAgent && { owner: userData.owner_uid }),
        },
      });
    } catch (error) {
      console.error("Connection setup failed:", error.message);
      socket.emit("connection_ack", {
        status: "error",
        message: error.message,
      });
      socket.disconnect(true);
      return;
    }

    processSocketEvent({
      socket,
      initializeSocket,
      sendToUid,
      sendToTenantUid,
      sendToSocket,
      sendToAll,
      getConnectedUsers,
      getConnectionsByUid,
      getConnectionBySocketId,
      getAllSocketData,
    });

    // Disconnection handler
    socket.on("disconnect", (reason) => {
      // console.log(`Disconnected: ${socket.id} | Reason: ${reason}`);
    });

    // Error handler
    socket.on("error", (error) => {
      console.error(`Socket error (${socket.id}):`, error);
    });
  });

  return ioInstance;
}

// Utility functions
// tenantId (4o parametro, ADITIVO): quando informado — ou presente em
// data.tenantId / data.tenant_id — a emissao e exclusiva da sala
// tenant_{tenantId}_user_{uid}. Sem tenant -> comportamento legado original.
function sendToUid(uid, data, event = "message", tenantId = null) {
  if (!ioInstance) {
    console.warn("Socket.IO instance not initialized");
    return false;
  }

  const effectiveTenantId =
    tenantId ?? data?.tenantId ?? data?.tenant_id ?? null;

  if (effectiveTenantId !== null && effectiveTenantId !== undefined) {
    const room = `tenant_${effectiveTenantId}_user_${uid}`;
    const count = ioInstance.sockets.adapter.rooms.get(room)?.size || 0;
    if (count > 0) {
      ioInstance.to(room).emit(event, data);
      return count;
    }
    // Sala vazia/nao existente (sockets legados sem tenant): cai para o loop
    // legado restrito aos sockets SEM tenant (evita vazar entre tenants)
    let sentLegacy = 0;
    ioInstance.sockets.sockets.forEach((socket) => {
      if (
        socket.userData &&
        !socket.userData.tenantId &&
        (socket.userData.uid === uid ||
          (socket.userData.isAgent && socket.userData.owner_uid === uid))
      ) {
        socket.emit(event, data);
        sentLegacy++;
      }
    });
    return sentLegacy;
  }

  let sentCount = 0;
  ioInstance.sockets.sockets.forEach((socket) => {
    if (
      socket.userData &&
      (socket.userData.uid === uid ||
        (socket.userData.isAgent && socket.userData.owner_uid === uid))
    ) {
      socket.emit(event, data);
      sentCount++;
    }
  });

  return sentCount;
}

// ADITIVO: emissao sempre direcionada a sala do tenant
// io.to(`tenant_${tenantId}_user_${uid}`).emit(event, data)
function sendToTenantUid(tenantId, uid, data, event = "message") {
  if (!tenantId) {
    // Fallback defensivo: sem tenant, mantem o comportamento legado
    return sendToUid(uid, data, event);
  }
  return sendToUid(uid, data, event, tenantId);
}

function sendToSocket(socketId, data, event = "message") {
  if (!ioInstance) {
    console.warn("Socket.IO instance not initialized");
    return false;
  }

  const socket = ioInstance.sockets.sockets.get(socketId);
  if (socket) {
    socket.emit(event, data);
    return true;
  }

  console.warn(`Socket not found: ${socketId}`);
  return false;
}

// tenantId (3o parametro, ADITIVO): quando informado — ou presente em
// data.tenantId / data.tenant_id — o broadcast vai apenas para a sala
// tenant_{tenantId}. Sem tenant -> broadcast global (modo legado, deprecado).
function sendToAll(data, event = "message", tenantId = null) {
  if (!ioInstance) {
    console.warn("Socket.IO instance not initialized");
    return false;
  }

  const effectiveTenantId =
    tenantId ?? data?.tenantId ?? data?.tenant_id ?? null;

  if (effectiveTenantId !== null && effectiveTenantId !== undefined) {
    ioInstance.to(`tenant_${effectiveTenantId}`).emit(event, data);
    return true;
  }

  ioInstance.emit(event, data);
  return true;
}

function getConnectedUsers() {
  if (!ioInstance) return [];

  const users = [];
  ioInstance.sockets.sockets.forEach((socket) => {
    if (socket.userData) {
      users.push({
        socketId: socket.id,
        uid: socket.userData.uid,
        isAgent: socket.userData.isAgent,
        connectedAt: socket.userData.connectedAt,
        ...(socket.userData.isAgent && { owner: socket.userData.owner_uid }),
      });
    }
  });
  return users;
}

function getConnectionsByUid(uid, includeAgents = false) {
  if (!ioInstance) {
    console.warn("Socket.IO instance not initialized");
    return [];
  }

  const connections = [];
  ioInstance.sockets.sockets.forEach((socket) => {
    if (socket.userData) {
      // Include direct uid matches
      if (socket.userData.uid === uid) {
        connections.push({
          socketId: socket.id,
          userData: socket.userData,
          connectedAt: socket.userData.connectedAt,
        });
      }
      // If includeAgents is true, also include agents where owner_uid matches
      else if (
        includeAgents &&
        socket.userData.isAgent &&
        socket.userData.owner_uid === uid
      ) {
        connections.push({
          socketId: socket.id,
          userData: socket.userData,
          connectedAt: socket.userData.connectedAt,
          isOwnedAgent: true, // Optional flag to identify these connections
        });
      }
    }
  });

  return connections;
}

function getConnectionBySocketId(socketId) {
  if (!ioInstance) {
    console.warn("Socket.IO instance not initialized");
    return null;
  }

  const socket = ioInstance.sockets.sockets.get(socketId);
  if (!socket || !socket.userData) {
    return null;
  }

  return {
    socketId: socket.id,
    userData: socket.userData,
    connectedAt: socket.userData.connectedAt,
    handshake: socket.handshake,
    rooms: Array.from(socket.rooms),
  };
}

function getAllSocketData() {
  if (!ioInstance) {
    console.warn("Socket.IO instance not initialized");
    return [];
  }

  const socketsData = [];

  ioInstance.sockets.sockets.forEach((socket) => {
    const socketInfo = {
      // Core identification
      id: socket.id,
      connected: socket.connected,
      disconnected: socket.disconnected,

      // User context
      userData: socket.userData || null,
      decodedToken: socket.decodedToken || null,

      // Network details
      handshake: {
        headers: socket.handshake.headers,
        time: socket.handshake.time,
        address: socket.handshake.address,
        xdomain: socket.handshake.xdomain,
        secure: socket.handshake.secure,
      },

      // Room membership
      rooms: Array.from(socket.rooms),

      // Operational state
      flags: {
        hasJoinedDefaultRoom: socket.rooms.has(socket.id), // Always true for default room
        isAuthenticated: !!socket.decodedToken,
      },

      // Timestamps
      connectedAt: socket.userData?.connectedAt || null,
      lastActivity: new Date(), // Current time as last activity proxy
    };

    socketsData.push(socketInfo);
  });

  return socketsData;
}

module.exports = {
  initializeSocket,
  sendToUid,
  sendToTenantUid,
  sendToSocket,
  sendToAll,
  getConnectedUsers,
  getConnectionsByUid,
  getConnectionBySocketId,
  getAllSocketData,
  getSocketIo: () => ioInstance,
};
