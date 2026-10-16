import fs from 'fs';
import path from 'path';
import prisma from '../Backend/config/prisma.js';

async function updateCourse() {
  const courseId = '60f9da04-d8e8-43cd-8d6d-17c882c9e1ae';
  const course = await prisma.course.findUnique({
    where: { id: courseId }
  });

  if (!course) {
    console.error('Course not found:', courseId);
    return;
  }

  const slidesDir = path.resolve('scratch/slides_out');
  const files = fs.readdirSync(slidesDir);
  console.log('Found slide files in scratch/slides_out:', files.length);

  const curriculum = course.curriculum || {};
  const lessons = curriculum.lessons || [];

  for (let i = 0; i < lessons.length; i++) {
    const slideNum = i + 1;
    // Search for Slide{slideNum}.PNG or Slide{slideNum}.png
    const matchingFile = files.find(f => {
      const match = f.match(/Slide(\d+)\.png$/i);
      return match && parseInt(match[1], 10) === slideNum;
    });

    if (matchingFile) {
      const filePath = path.join(slidesDir, matchingFile);
      const imgBuffer = fs.readFileSync(filePath);
      const base64Data = imgBuffer.toString('base64');
      const dataUrl = `data:image/png;base64,${base64Data}`;

      const slideVisual = {
        id: `full_slide_${slideNum}`,
        dataUrl,
        fileName: matchingFile,
        mimetype: 'image/png',
        sourceSlide: slideNum,
        name: `Slide ${slideNum}: ${lessons[i].title}`,
        descr: `Full presentation slide for ${lessons[i].title}`,
        purpose: `Exact PowerPoint Presentation Slide ${slideNum}`,
        sizeBytes: imgBuffer.length
      };

      // Set as primary visual
      lessons[i].visual = slideVisual;
      lessons[i].visuals = [slideVisual, ...(lessons[i].visuals || []).filter(v => !v.id?.startsWith('full_slide_'))];
      lessons[i].slideNumber = slideNum;
      if (lessons[i].slideData) {
        lessons[i].slideData.images = lessons[i].visuals;
      }
      console.log(`Updated Lesson ${slideNum} ("${lessons[i].title}") with exact slide image (${(imgBuffer.length / 1024).toFixed(1)} KB)`);
    } else {
      console.warn(`No matching slide file found for Lesson ${slideNum}`);
    }
  }

  curriculum.lessons = lessons;

  await prisma.course.update({
    where: { id: courseId },
    data: { curriculum }
  });

  console.log('Course curriculum updated successfully with exact PPT slide visuals!');
}

updateCourse()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Update failed:', err);
    process.exit(1);
  });
