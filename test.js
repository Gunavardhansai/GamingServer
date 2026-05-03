import { io } from "socket.io-client";

const socket = io("http://localhost:3000");

socket.on("connect", () => {
  console.log("Connected ✅", socket.id);

  socket.emit("JOIN_ROOM", {
    playerId: "Player1"
  });
});

socket.on("ROOM_JOINED", (data) => {
  console.log("Joined room:", data);
});

socket.on("connect_error", (err) => {
  console.log("Error:", err.message);
});