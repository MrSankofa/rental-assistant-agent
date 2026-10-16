import { askRentalAgent } from "./openai"

const main = async () => {
  try {
    const response = await askRentalAgent("Is this still available?");


  } catch (error) {
      console.log("This is the error: ", error);
  }
  



}

main();