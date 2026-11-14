"use strict";

const {askAI}=require("../src/agent/openai");

const cases=[
  {
    name:"Manual garage door",
    question:"Is the garage at the Dearborn Heights Rental automatic?"
  },
  {
    name:"Included appliances",
    question:"Does the Dearborn Heights Rental have a dishwasher?"
  },
  {
    name:"Pet policy",
    question:"How many pets can I have at the Dearborn Heights Rental, and how much does that cost?"
  },
  {
    name:"Property isolation",
    question:"Does the Detroit Rental have a garage with an automatic opener?"
  },
  {
    name:"Tour terminology",
    question:"Can I schedule a showing at the Dearborn Heights Rental?"
  }
];

async function main(){
  if(!process.env.OPENAI_API_KEY){
    throw new Error("OpenAI credential unavailable");
  }

  if(process.env.PHASE25_ACCEPTANCE_ONLY!=="true"){
    throw new Error("Acceptance-only execution guard missing");
  }

  console.log("PHASE25_AI_ACCEPTANCE_STARTED");
  console.log("Cases:",cases.length);

  for(const item of cases){
    console.log("\n===== "+item.name+" =====");
    console.log("QUESTION:",item.question);

    const result=await askAI(item.question);

    if(!result || !result.answer){
      throw new Error("Empty AI response");
    }

    console.log("ANSWER:",result.answer);
  }

  console.log("\nPHASE25_AI_RESPONSES_READY_FOR_REVIEW");
}

main().catch(error=>{
  console.error(
    "PHASE25_AI_ACCEPTANCE_FAILED:",
    error.message
  );
  process.exitCode=1;
});
