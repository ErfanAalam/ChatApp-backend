import express from "express";
import bcrypt from "bcryptjs";
import { createServer } from "http"
import mongoose, { isObjectIdOrHexString } from "mongoose";
import cors from "cors";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import env from "dotenv";
import userModel from "./models/user.model.js";
import authMiddleware from "./middleware/authmiddleware.js";
import { Server } from "socket.io";
import { encrypt } from "./encryption.js";
import { decrypt } from "./encryption.js";


const app = express();
const port = process.env.port || 8001;
const server = createServer(app);

app.use(
  cors({
    origin:  ["https://chatapp-frontend-dq1n.onrender.com"],
    // origin:  ["http://localhost:5173"],
    // http://localhost:5173
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

env.config();

// database connection

mongoose.connect(process.env.MONGOURL).then(() => {
  console.log("Database connected succesfully");

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server is running on ${port}`);
  });
});

// debugging for mobile

app.get("/", (req, res) => {
  res.send("hello erfan");
});

// Socket server initalization


const io = new Server(server, {
  cors: {
    origin:  ["https://chatapp-frontend-dq1n.onrender.com"],
    // origin:  ["http://localhost:5173"],
    methods: ["POST", "GET"],
  },
});

const onlineUsers = {};

io.on("connection", (socket) => {
  let socketId = socket.id;

  console.log("scoket is connected", socket.id);

  socket.on("initialize-socket", async (userId) => {
    if (!userId) {
      console.warn("No userId provided for socket initialization.");
      return;
    }

    onlineUsers[userId] = socketId;
    await userModel.findByIdAndUpdate(userId, { socketId });
    console.log(`User ${userId} is online with socket ID ${socket.id}`);
  });

  // Handle private messages
  socket.on("private-message", async ({ senderId, recipientId, message }) => {
    const recipientSocketId = onlineUsers[recipientId];

    // const newMessage = { senderId, message, timestamp: new Date() };

    // await userModel.findByIdAndUpdate(senderId, {
    //   $push: { messages: newMessage },
    // });
    // await userModel.findByIdAndUpdate(recipientId, {
    //   $push: { messages: newMessage },
    // });

    // if (recipientSocketId) {
    //   io.to(recipientSocketId).emit("receive-message", { senderId, message });
    //   console.log(`Message sent to user ${recipientId}: ${message}`);
    // } else {
    //   console.log(`User ${recipientId} is offline`);
    // }

    if (!recipientSocketId) {
      console.log(`User ${recipientId} is offline, message saved.`);
      return;
    }

    io.to(recipientSocketId).emit("receive-message", { senderId, message });

    console.log(`Message sent to user ${recipientId}: ${message}`);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socketId}`);
    const userId = Object.keys(onlineUsers).find(
      (key) => onlineUsers[key] === socketId
    );
    // if (userId) {
    //   delete onlineUsers[userId];
    // }
  });
});

// handle user registeration

app.post("/register", async (req, res) => {
  const { username, email, password, profileImage } = req.body;

  const existinguser = await userModel.findOne({ email });

  if (existinguser) {
    return res.json({ result: "user already exist" });
  }

  try {
    const hashedpass = await bcrypt.hash(password, 10);

    const userToSave = await userModel.create({
      profileImage,
      username,
      email,
      password: hashedpass,
      socketId: null,
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

    if (onlineUsers[user._id]) {
      await userModel.findByIdAndUpdate(user._id, {
        socketId: onlineUsers[user._id],
      });
    }
    const isProduction = process.env.NODE_ENV === "production";

    res.cookie("token", token, {
      httpOnly: true,
      secure: isProduction, // Secure only in production (Render)
      sameSite: isProduction ? "none" : "strict",
      maxAge: 20 * 24 * 60 * 60 * 1000, //token expire in 20 days
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

app.post("/logout", async (req, res) => {
  try {
    const token = req.cookies.token;
    if (token) {
      const decoded = jwt.verify(token, process.env.SECRET_KEY);
      if (decoded && decoded.id) {
        await userModel.findByIdAndUpdate(decoded.id, { socketId: null });
        delete onlineUsers[decoded.id];
      }
    }
    const isProduction = process.env.NODE_ENV === "production";

    res.clearCookie("token", {
      httpOnly: true,
      secure: isProduction, // Secure only in production (Render)
      sameSite: isProduction ? "none" : "strict",
    });
    return res.status(200).json({ result: "Logged out successfully" });
  } catch (error) {
    console.error("Error during logout:", error);
    return res.status(500).json({ result: "Error during logout" });
  }
});

// fetching all users
app.get("/allusers", async (req, res) => {
  const users = await userModel.find();
  console.log(onlineUsers);

  res.json({ users: users, onlineUsers: onlineUsers });
});

// fetch message from the database comes from another user when he is offline
app.get("/messages/:userId/:recipientId", async (req, res) => {
  const { userId, recipientId } = req.params;

  try {
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ result: "User not found" });
    }
    // console.log("Fetched user:", user);

    // Filter messages between the sender and recipient
    const userMessages = user.messages || []; // Fallback to empty array
    const messages = userMessages.filter(
      (msg) =>
        (msg.senderId === userId && msg.recipientId === recipientId) ||
        (msg.senderId === recipientId && msg.recipientId === userId)
    );

    // 🔓 Decrypt each message
    const decryptedMessages = messages?.map((msg) => ({
      ...msg._doc,
      message: decrypt({ content: msg.message, iv: msg.iv })
    }));

    res.json({ messages: decryptedMessages });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ result: "Error fetching messages", error });
  }
});

app.post("/messages", async (req, res) => {
  const { senderId, recipientId, message, createdAt } = req.body;

  if (!senderId || !recipientId || !message) {
    return res.status(400).json({ result: "Invalid data provided" });
  }

  try {
    const sender = await userModel.findById(senderId);
    const recipient = await userModel.findById(recipientId);

    if (!sender || !recipient) {
      return res.status(404).json({ result: "Sender or recipient not found" });
    }

    // 🔐 Encrypt the message
    const encrypted = encrypt(message);

    const newMessage = {
      recipientId,
      senderId,
      message: encrypted.content, // encrypted content
      iv: encrypted.iv, // save IV for decryption later
      timestamp: createdAt || Date.now(),
    };

    // Save message for sender
    sender.messages.push(newMessage);
    await sender.save();

    // Save message for recipient
    recipient.messages.push(newMessage);
    await recipient.save();

    res.status(201).json({ result: "Message saved successfully" });
  } catch (error) {
    console.error("Error saving message:", error);
    res.status(500).json({ result: "Error saving message", error });
  }
});

// Clear all messages for a user
app.delete("/messages/:userId/:recipientId", async (req, res) => {
  const { userId,recipientId } = req.params;

  try {
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ result: "User not found" });
    }

    user.messages = user.messages.filter((msg) => msg.recipientId !== recipientId); // Clear all messages
    await user.save();

    res.status(200).json({ result: "All messages cleared successfully" });
  } catch (error) {
    console.error("Error clearing messages:", error);
    res.status(500).json({ result: "Error clearing messages", error });
  }
});


// FetchUserProfile
app.post("/fetchprofile", async (req, res) => {
  try {
    const { userId } = req.body; // Get userId from request body

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await userModel.findById(userId).select("-password"); // Exclude password

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ message: "Server error" });
  }
});

