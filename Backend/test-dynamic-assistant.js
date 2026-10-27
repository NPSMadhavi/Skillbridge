import { containsWakeWord, extractQuestionFromWakeWord } from '../Frontend/src/services/voiceTutorService.js';

console.log('====================================================');
console.log('   DYNAMIC ASSISTANT NAME & WAKE-WORD TEST SUITE    ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    failed++;
  }
}

// Scenario 1: Configured Name = "Veda", Wake Word = "Hey Veda"
console.log('--- TEST GROUP 1: Configured as "Veda" ---');
const vedaWake = "Hey Veda";
const vedaName = "Veda";

assert(containsWakeWord("Veda", vedaWake, vedaName), 'Saying "Veda" activates');
assert(containsWakeWord("veda", vedaWake, vedaName), 'Saying lowercase "veda" activates');
assert(containsWakeWord("Hey Veda", vedaWake, vedaName), 'Saying "Hey Veda" activates');
assert(containsWakeWord("Hello Veda", vedaWake, vedaName), 'Saying "Hello Veda" activates');
assert(containsWakeWord("Veda, what is artificial intelligence?", vedaWake, vedaName), 'Same-utterance question activates');
assert(!containsWakeWord("Maya", vedaWake, vedaName), 'Saying "Maya" does NOT activate when name is Veda');
assert(!containsWakeWord("ARIA", vedaWake, vedaName), 'Saying "ARIA" does NOT activate when name is Veda');
assert(!containsWakeWord("invader", vedaWake, vedaName), 'Partial match "invader" does NOT activate');
assert(!containsWakeWord("everyday", vedaWake, vedaName), 'Word "everyday" does NOT activate');

// Test question extraction
const q1 = extractQuestionFromWakeWord("Veda, what is artificial intelligence?", vedaWake, vedaName);
assert(q1.toLowerCase() === "what is artificial intelligence?", `Extracted question correctly: "${q1}"`);

const q2 = extractQuestionFromWakeWord("Hey Veda explain what is 5S methodology", vedaWake, vedaName);
assert(q2.toLowerCase() === "explain what is 5s methodology", `Extracted question from "Hey Veda": "${q2}"`);

const q3 = extractQuestionFromWakeWord("Veda", vedaWake, vedaName);
assert(q3 === "", `Standalone wake word returns empty question: "${q3}"`);


// Scenario 2: Configured Name changed to "Maya", Wake Word = "Hey Maya"
console.log('\n--- TEST GROUP 2: Configured as "Maya" (Dynamic Switch) ---');
const mayaWake = "Hey Maya";
const mayaName = "Maya";

assert(containsWakeWord("Maya", mayaWake, mayaName), 'Saying "Maya" activates');
assert(containsWakeWord("Hey Maya", mayaWake, mayaName), 'Saying "Hey Maya" activates');
assert(containsWakeWord("Maya what time is it?", mayaWake, mayaName), 'Same-utterance "Maya what time is it?" activates');
assert(!containsWakeWord("Veda", mayaWake, mayaName), 'Saying "Veda" does NOT activate when name is Maya');
assert(!containsWakeWord("ARIA", mayaWake, mayaName), 'Saying "ARIA" does NOT activate when name is Maya');
assert(!containsWakeWord("mayonnaise", mayaWake, mayaName), 'Partial match "mayonnaise" does NOT activate');

const q4 = extractQuestionFromWakeWord("Maya what is machine learning?", mayaWake, mayaName);
assert(q4.toLowerCase() === "what is machine learning?", `Extracted question from Maya: "${q4}"`);


// Scenario 3: Configured Name changed to custom name "Jarvis"
console.log('\n--- TEST GROUP 3: Custom Arbitrary Name "Jarvis" ---');
const jarvisWake = "Hey Jarvis";
const jarvisName = "Jarvis";

assert(containsWakeWord("Jarvis", jarvisWake, jarvisName), 'Saying "Jarvis" activates');
assert(containsWakeWord("Hey Jarvis", jarvisWake, jarvisName), 'Saying "Hey Jarvis" activates');
assert(!containsWakeWord("Veda", jarvisWake, jarvisName), 'Saying "Veda" does NOT activate when name is Jarvis');
assert(!containsWakeWord("Maya", jarvisWake, jarvisName), 'Saying "Maya" does NOT activate when name is Jarvis');

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
