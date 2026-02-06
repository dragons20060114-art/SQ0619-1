
import { GoogleGenAI, Type } from "@google/genai";

// Initialize the Gemini API client using the environment variable directly as required.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export interface ExtractedOrder {
  name: string;
  price: number;
  note?: string;
}

export async function analyzeMenuContent(base64Data: string, mimeType: string): Promise<ExtractedOrder[]> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { 
            text: "請分析這張菜單或訂單列表圖片。提取所有的品項名稱、價格和任何備註。指令：1. 必須使用圖片中的原始語言（繁體中文），絕對不要翻譯成英文。2. 如果價格包含不同尺寸（如大杯、中杯），請分別列出。3. 以 JSON 格式回傳。" 
          },
          { inlineData: { mimeType: mimeType, data: base64Data } }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            orders: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, description: "品項原始名稱（繁體中文）" },
                  price: { type: Type.NUMBER, description: "數值價格" },
                  note: { type: Type.STRING, description: "額外的備註或內容描述" }
                },
                required: ["name", "price"]
              }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    
    const parsed = JSON.parse(text);
    return parsed.orders || [];
  } catch (error) {
    console.error("Gemini 辨識失敗:", error);
    throw error;
  }
}
