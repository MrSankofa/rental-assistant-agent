const { askAI } = require("./src/agent/openai");

async function main() {
  try {
    const response = await askAI(
      "Hello! What can you help me with as a rental assistant?"
    );

    console.log("AI Agent:", response);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

main();