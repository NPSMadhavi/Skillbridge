import prisma from '../config/prisma.js';
import { cleanUnsupportedWords } from '../utils/contentQuality.js';

const MODULE_DEFINITIONS = [
  {
    moduleTitle: "5S Overview & Foundations",
    chunkIndices: [0, 1, 2],
    lessonTitles: [
      "Introduction to 5S Methodology",
      "Definition and Core Principles",
      "5S Mnemonics and Workplace Value"
    ]
  },
  {
    moduleTitle: "The Five Pillars of 5S",
    chunkIndices: [3, 4, 5, 6, 7],
    lessonTitles: [
      "1S: Seiri (Sort) - Clearing Unneeded Items",
      "2S: Seiton (Set in Order) - Effective Organization",
      "3S: Seiso (Shine) - Cleaning & Inspection",
      "4S: Seiketsu (Standardize) - Maintaining Routine & Habits",
      "5S: Shitsuke (Sustain) - Self-Discipline & Rule Adherence"
    ]
  },
  {
    moduleTitle: "Workplace Standards & Benefits",
    chunkIndices: [8, 9, 10, 11, 12],
    lessonTitles: [
      "Benefits of 5S (Safety, Quality & Productivity)",
      "5S Cultural Goals & Organizational Vision",
      "Three Classes of Workplace Cleanliness",
      "Practical 5S Implementation Steps",
      "Employee Involvement & Culture Building"
    ]
  },
  {
    moduleTitle: "Workstation Scoring & Practical Audits",
    chunkIndices: [13, 14, 15, 16, 17, 18, 19],
    lessonTitles: [
      "Workstation 5S Scoring Sheet & Standards",
      "Red Tag & Sorting Audit Assessment",
      "Material Stacking & Spool Storage Standards",
      "Tool Placement & Shelving Organization",
      "Machine Guarding & Maintenance Safety",
      "Walkway Clearance & Clutter Elimination",
      "Forklift Access & Floor Demarcation Markings"
    ]
  },
  {
    moduleTitle: "Audit Cases & Sustained Practice",
    chunkIndices: [20, 21, 22, 23, 24, 25, 26],
    lessonTitles: [
      "Audit Evaluation Case 1: Machine Areas",
      "Audit Evaluation Case 2: Storage Racks & Pallets",
      "Audit Evaluation Case 3: Workshop Tools & Equipment",
      "Audit Evaluation Case 4: Office Desk & Paperwork Standards",
      "Team Leader Roles & Daily Housekeeping Routines",
      "Overcoming 5S Implementation Challenges",
      "5S Course Summary & Operational Commitment"
    ]
  }
];

async function update5SCourse() {
  const course = await prisma.course.findFirst({
    where: { title: { contains: '5S' } },
    include: {
      chunks: {
        orderBy: { chunkIndex: 'asc' }
      }
    }
  });

  if (!course) {
    console.error('5S course not found');
    return;
  }

  console.log(`Updating Course ${course.id}: ${course.title} with ${course.chunks.length} chunks`);

  // 1. Update chunks in CourseChunk table to clean unsupported words
  for (const chunk of course.chunks) {
    let cleanConcept = cleanUnsupportedWords(chunk.concept || '');
    let cleanSubtopic = cleanUnsupportedWords(chunk.subtopic || '');
    if (cleanSubtopic.toLowerCase() === 'null') cleanSubtopic = '';
    
    // Find matching lesson title if available
    for (const mod of MODULE_DEFINITIONS) {
      const idx = mod.chunkIndices.indexOf(chunk.chunkIndex);
      if (idx !== -1 && mod.lessonTitles[idx]) {
        cleanConcept = mod.lessonTitles[idx];
        break;
      }
    }

    const cleanText = cleanUnsupportedWords(chunk.chunkText || '');
    await prisma.courseChunk.update({
      where: { id: chunk.id },
      data: {
        concept: cleanConcept,
        subtopic: cleanSubtopic || null,
        chunkText: cleanText
      }
    });
  }
  console.log('Cleaned all CourseChunk records in database.');

  // 2. Build full curriculum lessons list
  const lessons = [];
  const modulesSummary = [];
  let lessonCounter = 1;

  for (const mod of MODULE_DEFINITIONS) {
    const modLessons = [];
    for (let i = 0; i < mod.chunkIndices.length; i++) {
      const chunkIdx = mod.chunkIndices[i];
      const chunk = course.chunks.find(c => c.chunkIndex === chunkIdx) || {};
      const lessonTitle = mod.lessonTitles[i];
      const slideNum = chunk.sourcePage || (chunkIdx + 1);

      // Clean explanation
      let explanation = chunk.chunkText || '';
      explanation = cleanUnsupportedWords(explanation);

      const lessonObj = {
        id: lessonCounter,
        lessonId: lessonCounter,
        title: lessonTitle,
        moduleTitle: mod.moduleTitle,
        chapterTitle: mod.moduleTitle,
        duration: '02:00',
        sourceSlides: [slideNum],
        slideNumber: slideNum,
        explanation: explanation,
        explanations: {
          en: explanation
        },
        keyPoints: chunk.keyPoints || [],
        status: lessonCounter === 1 ? 'active' : 'locked'
      };

      lessons.push(lessonObj);
      modLessons.push(lessonObj);
      lessonCounter++;
    }

    modulesSummary.push({
      title: mod.moduleTitle,
      lessons: modLessons,
      duration: `${modLessons.length * 2} mins`
    });
  }

  // 3. Update course curriculum JSON
  const existingCurriculum = typeof course.curriculum === 'object' && course.curriculum ? course.curriculum : {};
  const updatedCurriculum = {
    ...existingCurriculum,
    lessons: lessons,
    curriculum: modulesSummary,
    totalLessons: lessons.length,
    modules: modulesSummary
  };

  await prisma.course.update({
    where: { id: course.id },
    data: {
      curriculum: updatedCurriculum
    }
  });

  console.log(`Successfully updated course curriculum: ${lessons.length} lessons across ${modulesSummary.length} modules!`);
}

update5SCourse().catch(console.error).finally(() => prisma.$disconnect());
