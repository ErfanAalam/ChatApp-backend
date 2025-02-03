import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  password: {
    type: String,
    required: true,
  },
  socketId: {
    type: String,
    default: null,
  },
  messages: [
    {
      senderId: String,
      message: String,
      timestamp: { type: Date, default: Date.now },
    },
  ],
});

const userModel = mongoose.model("user", UserSchema);

export default userModel