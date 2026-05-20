import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase payload limit for images
app.use(express.json({ limit: "50mb" }));

// Gemini initialization
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// API Routes
app.post("/api/analyze-image", async (req, res) => {
  try {
    const { base64Data, mimeType } = req.body;

    if (!base64Data || !mimeType) {
      return res.status(400).json({ error: "Missing image data or mimeType" });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType,
          },
        },
        "You are a 'Visual Logistics Coordinator.' Your job is to bridge the gap between physical images and structured inventory data. Scan the image and list all detectable items. For each item, provide a bounding box. Output coordinates in this format: {\"label\": \"item_1\", \"box_2d\": [ymin, xmin, ymax, xmax]} where coordinates are scaled between 0 and 1000."
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              box_2d: {
                type: Type.ARRAY,
                items: { type: Type.NUMBER },
              },
            },
            required: ["label", "box_2d"],
          },
        },
      },
    });

    if (response.text) {
      const parsedBoxes = JSON.parse(response.text);
      res.json({ boxes: parsedBoxes });
    } else {
      res.status(500).json({ error: "Empty response from Gemini" });
    }
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    const status = error.status || (error.message?.includes("429") ? 429 : 500);
    res.status(status).json({ error: error.message });
  }
});

async function bootstrap() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

bootstrap();
