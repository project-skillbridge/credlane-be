import * as fs from 'fs';
import * as path from 'path';
import { validateLibraryFile, type LibraryFile } from './library-import';

const mc = (n: number, keyIndex = 1) => {
  const options = [
    `Option A${n} is short`,
    `Option B${n} is a bit longer`,
    `Option C${n} is the longest option of all four here`,
    `Option D${n} is mid`,
  ];
  return {
    questionText: `Which choice is correct for scenario ${n}?`,
    questionType: 'multiple_choice',
    options,
    correctAnswer: options[keyIndex],
  };
};

const valid = (): LibraryFile => ({
  title: 'Frontend screening',
  estimatedCompletionTime: '15 minutes',
  roleTrack: 'frontend_developer',
  experienceLevel: 'mid',
  questions: Array.from({ length: 6 }, (_, i) =>
    mc(i + 1, i % 4 === 2 ? 0 : 1),
  ),
});

describe('validateLibraryFile', () => {
  it('accepts a well-formed file', () => {
    expect(validateLibraryFile(valid())).toEqual([]);
  });

  it('accepts the bundled dev sample', () => {
    const sample = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          '../../../scripts/library-samples/frontend-mid-sample.json',
        ),
        'utf-8',
      ),
    ) as LibraryFile;
    expect(validateLibraryFile(sample)).toEqual([]);
  });

  it('rejects an unknown track and level', () => {
    const file = { ...valid(), roleTrack: 'astronaut', experienceLevel: 'god' };
    const errors = validateLibraryFile(file);
    expect(errors.join()).toContain('roleTrack');
    expect(errors.join()).toContain('experienceLevel');
  });

  it('rejects fewer than five questions', () => {
    const file = { ...valid(), questions: valid().questions.slice(0, 3) };
    expect(validateLibraryFile(file).join()).toContain('needs 5 to 30');
  });

  it('rejects a key that is not one of the options', () => {
    const file = valid();
    file.questions[0].correctAnswer = 'something else';
    expect(validateLibraryFile(file).join()).toContain('must exactly match');
  });

  it('rejects duplicate text and duplicate options', () => {
    const file = valid();
    file.questions[1].questionText = file.questions[0].questionText;
    file.questions[2].options = ['same', 'same', 'x', 'y'];
    file.questions[2].correctAnswer = 'x';
    const errors = validateLibraryFile(file).join();
    expect(errors).toContain('duplicate text');
    expect(errors).toContain('distinct');
  });

  it('rejects "all of the above" style options', () => {
    const file = valid();
    file.questions[0].options = ['a1', 'b1', 'c1', 'All of the above'];
    file.questions[0].correctAnswer = 'a1';
    expect(validateLibraryFile(file).join()).toContain('all/none of the above');
  });

  it('rejects true/false questions without True and False', () => {
    const file = valid();
    file.questions[0] = {
      questionText: 'React is a JavaScript library for building UIs.',
      questionType: 'true_false',
      options: ['Yes', 'No'],
      correctAnswer: 'Yes',
    };
    expect(validateLibraryFile(file).join()).toContain('True and False');
  });

  it('rejects content where the longest option is usually the key', () => {
    const file = valid();
    file.questions = file.questions.map((_, i) => mc(i + 1, 2));
    expect(validateLibraryFile(file).join()).toContain('length is not a tell');
  });
});
