import express from "express";
import bcrypt from "bcryptjs";
import mongoose, { isObjectIdOrHexString } from "mongoose";
import cors from "cors";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import env from "dotenv";
import userModel from "./models/user.model.js";
import authMiddleware from "./middleware/authmiddleware.js";
import { Server } from "socket.io";

const app = express();
const port = process.env.port || 8001;

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

env.config();

mongoose.connect(process.env.MONGOURL).then(() => {
  console.log("Database connected succesfully");

  app.listen(port, () => {
    console.log(`Server is running on ${port}`);
  });
});

// Socket server initalization

const io = new Server(port + 1, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["POST", "GET"],
  },
});

const onlineUsers = {};

io.on("connection", (socket) => {
  console.log("scoket is connected", socket.id);

  socket.on("register-user", (userId) => {
    onlineUsers[userId] = socket.id;
    console.log(`User ${userId} is online with socket ID ${socket.id}`);
  });

  console.log(onlineUsers);

  // Handle private messages
  socket.on("private-message", ({ senderId, recipientId, message }) => {
    const recipientSocketId = onlineUsers[recipientId];

    const data = {
      senderId,
      message,
    };

    if (recipientSocketId) {
      console.log(recipientSocketId);

      console.log(senderId);
      console.log("Emitting receive-message:", { senderId, message });
      io.to(recipientSocketId).emit("receive-message",{ senderId, message });
      console.log(message);
    } else {
      console.log(`User ${recipientId} is offline`);
    }
  });

  // Handle disconnection
  // socket.on("disconnect", () => {
  //   for (const userId in onlineUsers) {
  //     if (onlineUsers[userId] === socket.id) {
  //       delete onlineUsers[userId];
  //       console.log(`User ${userId} disconnected`);
  //     }
  //   }
  // });
});

app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  const existinguser = await userModel.findOne({ email });

  if (existinguser) {
    return res.json({ result: "user exist" });
  }

  try {
    const hashedpass = await bcrypt.hash(password, 10);

    const userToSave = await userModel.create({
      username,
      email,
      password: hashedpass,
    });

    res.json({ result: "User successfully registered", user: userToSave });
  } catch (error) {
    res.status(500).json({ result: "Error registering user", error });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await userModel.findOne({ email });

    // console.log(user);

    if (!user) {
      return res.status(401).json({ result: "User not found" });
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ result: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username, email: user.email },
      process.env.SECRET_KEY,
      { expiresIn: "3h" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      maxAge: 3600000,
    });

    res.json({ result: "Login successful" });
  } catch (error) {
    res.status(500).json({ result: "Error logging in", error });
  }
});

app.get("/getUser", authMiddleware, (req, res) => {
  res.status(200).json({ result: req.user });
});

app.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: false,
    sameSite: "strict",
  });
  return res.status(200).json({ result: "Logged out successfully" });
});

app.get("/allusers", async (req, res) => {
  const users = await userModel.find();
  // console.log(users);

  res.json({ users: users });
});
