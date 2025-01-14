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

// database connection

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
  let socketId = socket.id;
  console.log(socketId);
  
  console.log("scoket is connected", socket.id);
  socket.on("register-user", (userId) => {
    onlineUsers[userId] = socketId;
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
      io.to(recipientSocketId).emit("receive-message", { senderId, message });
      console.log(message);
    } else {
      console.log(`User ${recipientId} is offline`);
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socketId}`);
    const userId = Object.keys(onlineUsers).find(key => onlineUsers[key] === socketId);
    if (userId) delete onlineUsers[userId];
  });
});

// handle user registeration 

app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  const existinguser = await userModel.findOne({ email });

  if (existinguser) {
    return res.json({ result: "user already exist" });
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
    res.status(500).json({ result: "Error in registering user", error });
  }
});


// handle login process

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await userModel.findOne({ email });

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
      // maxAge: 86400000, 1 day
      maxAge: 3 * 24 * 60 * 60 * 1000, //3 day
    });

    res.json({ result: "Login successful" });
  } catch (error) {
    res.status(500).json({ result: "Error logging in", error });
  }
});

// fetch the loggedin user

app.get("/getUser", authMiddleware, (req, res) => {
  res.status(200).json({ result: req.user });
});

// logout user from application

app.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: false,
    sameSite: "strict",
  });
  return res.status(200).json({ result: "Logged out successfully" });
});


// fetching all users
app.get("/allusers", async (req, res) => {
  const users = await userModel.find();
  // console.log(users);

  res.json({ users: users, onlineUsers: onlineUsers });
});
