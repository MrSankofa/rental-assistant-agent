"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const openai_1 = require("./openai");
const main = async () => {
    try {
        const response = await (0, openai_1.askRentalAgent)("Is this still available?");
        console.log("This is the response:", response);
    }
    catch (error) {
        console.log("This is the error: ", error);
    }
};
main();
