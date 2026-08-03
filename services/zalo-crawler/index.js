import { Zalo, ThreadType } from "zca-js";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const WEBHOOK_URL = process.env.WEBHOOK_URL || "http://localhost:8000/api/chat/zalo-webhook";

console.log("===============================================");
console.log("🚀 Starting Zalo Crawler Microservice (zca-js)");
console.log(`📡 Target Webhook: ${WEBHOOK_URL}`);
console.log("===============================================");

async function startZaloCrawler() {
  try {
    const zalo = new Zalo();
    console.log("🔑 Initializing Zalo QR Code Login...");
    console.log("👉 Please scan the QR Code that appears in terminal using your Zalo App.");

    const api = await zalo.loginQR();
    console.log("✅ Zalo Login Successful! Active session established.");

    api.listener.on("message", async (message) => {
      try {
        const isPlainText = typeof message.data?.content === "string";
        if (message.isSelf || !isPlainText) return;

        const text = message.data.content;
        const senderName = message.data.displayName || message.data.senderName || message.data.fromName || "Thành viên Zalo";
        const groupName = message.data.threadName || (message.type === ThreadType.Group ? "Nhóm Zalo" : "Nhắn tin riêng");

        console.log(`\n📩 [Zalo Message] From: ${senderName} | Group: ${groupName}`);
        console.log(`💬 Message Content: "${text}"`);

        // Forward to backend FastAPI webhook
        const response = await axios.post(WEBHOOK_URL, {
          text,
          sender_name: senderName,
          group_name: groupName,
          thread_id: message.threadId,
          thread_type: message.type === ThreadType.Group ? "Group" : "User",
          raw_data: message.data
        }, {
          headers: { "Content-Type": "application/json" },
          timeout: 15000
        });

        console.log(`✨ AI Task Webhook Response:`, response.data);
      } catch (err) {
        console.error("❌ Error forwarding Zalo message to webhook:", err.response?.data || err.message);
      }
    });

    api.listener.start();
    console.log("👂 Real-time Zalo listener is RUNNING. Waiting for new messages...");
  } catch (error) {
    console.error("❌ Failed to start Zalo Crawler:", error.message || error);
  }
}

startZaloCrawler();
