const { askAI } = require("./src/agent/openai");

async function main() {
  try {
    const answer = await askAI(
      "What can you tell me about the Virginia rental property?"
    );

    console.log("\nAI Agent:", answer);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

main();