import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  profileImage: {
    type: String,
    // required: true,
  },
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
      recipientId: String,
      senderId: String,
      message: String,
      timestamp: { type: Date, default: Date.now },
    },
  ],
});

const userModel = mongoose.model("user", UserSchema);

export default userModel