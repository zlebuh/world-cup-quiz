const fs = require('fs');

function loadQuiz(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const sections = [];
  let currentSection = null;
  let currentQuestion = null;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();

    const sectionMatch = trimmed.match(/^#\s+Section\s+\d+:\s+(.+)$/i);
    if (sectionMatch) {
      if (currentQuestion && currentSection) currentSection.questions.push(currentQuestion);
      currentQuestion = null;
      currentSection = { title: sectionMatch[1].trim(), questions: [] };
      sections.push(currentSection);
      continue;
    }

    const questionMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (questionMatch && currentSection) {
      if (currentQuestion) currentSection.questions.push(currentQuestion);
      currentQuestion = { text: questionMatch[2].trim(), answer: '' };
      continue;
    }

    const answerMatch = trimmed.match(/^Answer:\s*(.+)$/i);
    if (answerMatch && currentQuestion) {
      currentQuestion.answer = answerMatch[1].trim();
      continue;
    }
  }

  if (currentQuestion && currentSection) currentSection.questions.push(currentQuestion);

  return sections;
}

module.exports = { loadQuiz };
