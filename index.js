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
    origin:  ["http://192.168.31.119:5173","http://localhost:5173"],
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

env.config();

// database connection

mongoose.connect(process.env.MONGOURL).then(() => {
  console.log("Database connected succesfully");

  app.listen(port, "0.0.0.0", () => {
    console.log(`Server is running on ${port}`);
  });
});


// debugging for mobile

app.get("/",(req,res)=>{
  res.send("hello erfan")
})

// Socket server initalization

const io = new Server(port + 1, {
  cors: {
    origin:  ["http://192.168.31.119:5173","http://localhost:5173"],
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

    res.cookie("token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "strict",
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

    res.clearCookie("token", {
      httpOnly: true,
      secure: false,
      sameSite: "strict",
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
  // console.log(users);

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

    // Filter messages between the sender and recipient
    const messages = user.messages.filter(
      (msg) =>
        (msg.senderId === userId && msg.recipientId === recipientId) ||
        (msg.senderId === recipientId && msg.recipientId === userId)
    );

    res.json({ messages });
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
    // Save the message to the database
    const sender = await userModel.findById(senderId);
    const recipient = await userModel.findById(recipientId);

    if (!sender || !recipient) {
      return res.status(404).json({ result: "Sender or recipient not found" });
    }

    const newMessage = {
      recipientId,
      senderId,
      message,
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
app.delete("/messages/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ result: "User not found" });
    }

    user.messages = []; // Clear all messages
    await user.save();

    res.status(200).json({ result: "All messages cleared successfully" });
  } catch (error) {
    console.error("Error clearing messages:", error);
    res.status(500).json({ result: "Error clearing messages", error });
  }
});

