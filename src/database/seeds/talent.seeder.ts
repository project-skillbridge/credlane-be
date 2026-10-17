import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { User, UserRole } from '../../modules/users/entities/user.entity';
import { TalentProfile, TalentProfileStatus, TalentAvailabilityStatus } from '../../modules/talent/entities/talent-profile.entity';
import { EmployerPoolProfile } from '../../modules/talent/entities/employer-pool-profile.entity';
import { VerifiedLevel } from '../../modules/assessments/entities/assessment-question.entity';
import { Seeder } from './seeder.interface';
import { EMPLOYER_DESIRED_ROLES } from '../../modules/employer/employer.constants';

const FIRST_NAMES = [
  'John', 'Jane', 'Alice', 'Bob', 'Charlie', 'David', 'Emma', 'Frank', 'Grace', 'Henry',
  'Ivy', 'Jack', 'Kate', 'Leo', 'Mia', 'Noah', 'Olivia', 'Peter', 'Quinn', 'Rose',
  'Sam', 'Toby', 'Victor', 'Wendy', 'Zara', 'Liam', 'Sophia', 'Lucas', 'Amelia', 'Mason',
  'Evelyn', 'Ethan', 'Harper', 'Alexander', 'Ella', 'Michael', 'Aria', 'Daniel', 'Avery', 'James'
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Garcia', 'Rodriguez', 'Wilson',
  'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Hernandez', 'Moore', 'Martin', 'Jackson', 'Thompson', 'White',
  'Lopez', 'Lee', 'Gonzalez', 'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen'
];

const COUNTRIES = ['Nigeria', 'Kenya', 'Ghana', 'South Africa', 'United Kingdom', 'United States', 'Canada', 'Germany'];

const SKILLS_MAP: Record<string, string[]> = {
  product_designer: ['Figma', 'UI/UX Design', 'Wireframing', 'Prototyping', 'User Research'],
  frontend_developer: ['React', 'TypeScript', 'HTML5', 'CSS3', 'Next.js', 'Tailwind CSS'],
  data_analyst: ['SQL', 'Excel', 'Python', 'Tableau', 'PowerBI', 'Data Visualization'],
  cloud_devops: ['AWS', 'Docker', 'Kubernetes', 'CI/CD', 'Terraform', 'Linux'],
  product_manager: ['Product Strategy', 'Agile/Scrum', 'Jira', 'Roadmapping', 'User Stories'],
  backend_developer: ['Node.js', 'NestJS', 'PostgreSQL', 'TypeScript', 'Redis', 'REST APIs'],
  mobile_developer: ['React Native', 'Flutter', 'Swift', 'Kotlin', 'Mobile UI'],
  cybersecurity: ['Penetration Testing', 'Network Security', 'Cryptography', 'SIEM', 'OWASP'],
  data_scientist: ['Python', 'Machine Learning', 'Pandas', 'TensorFlow', 'Scikit-Learn', 'R'],
  marketing: ['SEO', 'Content Strategy', 'Google Analytics', 'Copywriting', 'Social Media'],
  quality_assurance: ['Selenium', 'Cypress', 'Jest', 'Manual Testing', 'Automation Testing'],
  fullstack_developer: ['React', 'Node.js', 'NestJS', 'TypeScript', 'PostgreSQL', 'AWS'],
  data_engineer: ['Python', 'Spark', 'Hadoop', 'ETL', 'Airflow', 'Snowflake'],
  ml_engineer: ['PyTorch', 'TensorFlow', 'MLOps', 'Computer Vision', 'NLP'],
  business_analyst: ['Process Mapping', 'SQL', 'UML', 'Requirements Gathering', 'Jira'],
  bi_developer: ['PowerBI', 'DAX', 'SSIS', 'SQL', 'Data Warehousing'],
  ux_researcher: ['User Interviews', 'Usability Testing', 'Persona Development', 'Surveys'],
  brand_designer: ['Adobe Illustrator', 'Photoshop', 'Typography', 'Logo Design', 'Branding'],
  customer_success: ['CRM', 'Customer Relations', 'Onboarding', 'SaaS Support', 'Intercom'],
  project_manager: ['Asana', 'Agile', 'Scrum', 'Risk Management', 'Resource Allocation'],
  operations_manager: ['Process Optimization', 'Logistics', 'Budgeting', 'Vendor Management'],
  hr_people_ops: ['Recruiting', 'Onboarding', 'Employee Engagement', 'HRIS', 'Talent Management']
};

export const talentSeeder: Seeder = {
  name: 'TalentSeeder',
  async run(dataSource: DataSource) {
    const userRepo = dataSource.getRepository(User);
    const profileRepo = dataSource.getRepository(TalentProfile);
    const poolRepo = dataSource.getRepository(EmployerPoolProfile);

    console.log('[TalentSeeder] Starting to seed job ready talents…');

    let count = 0;
    const passwordHash = await argon2.hash('Password123!');

    // Create 2 talents for each track to ensure full coverage and variety
    for (const track of EMPLOYER_DESIRED_ROLES) {
      for (let i = 0; i < 2; i++) {
        const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
        const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
        const email = `${track}_talent_${i + 1}@skillbridge.com`.toLowerCase();

        // Check if user already exists
        const existingUser = await userRepo.findOne({ where: { email } });
        if (existingUser) {
          continue;
        }

        const country = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
        const user = userRepo.create({
          email,
          password: passwordHash,
          first_name: firstName,
          last_name: lastName,
          country,
          avatar_url: `https://i.pravatar.cc/300?u=${encodeURIComponent(email)}`,
          is_verified: true,
          onboarding_complete: true,
          role: UserRole.TALENT
        });
        await userRepo.save(user);

        // Map track slug to a label (e.g., 'backend_developer' -> 'Backend Developer')
        const trackLabel = track
          .split('_')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ')
          .replace('Devops', 'DevOps');

        const skills = SKILLS_MAP[track] || ['Communication', 'Teamwork'];
        const score = 75 + Math.floor(Math.random() * 20); // 75 to 94 (job_ready range)
        const levels = [VerifiedLevel.MID, VerifiedLevel.SENIOR];
        const level = levels[Math.floor(Math.random() * levels.length)];

        const profile = profileRepo.create({
          user_id: user.id,
          role_track: track,
          role_tracks: [track],
          track,
          status: TalentProfileStatus.JOB_READY,
          profile_verified: true,
          claimed_level: level,
          validated_level: level,
          onboarding_step: 3,
          is_published: true,
          published_at: new Date(),
          availability_status: TalentAvailabilityStatus.ACTIVELY_LOOKING,
          personal_assessment_completed_at: new Date(),
          skill_assessment_completed_at: new Date(),
          advanced_assessment_completed_at: new Date(),
          personal_assessment_answers: {
            answers: []
          },
          bio: `Experienced ${trackLabel} with a strong background in developing scalable solutions. Passionate about building high-quality software and collaborating in cross-functional teams.`,
          region: country,
          resume_url: `https://example.com/resume/${encodeURIComponent(email)}.pdf`,
          resume_filename: 'resume.pdf',
          personal_website: `https://portfolio.example.com/${encodeURIComponent(email)}`
        });
        await profileRepo.save(profile);

        const pool = poolRepo.create({
          talent_profile_id: profile.id,
          candidate_id: user.id,
          verified_at: new Date(),
          track,
          specialization: skills[0],
          verified_level: level,
          score,
          tier: 'job_ready',
          strong_competencies: skills,
          competency_scores: skills.reduce((acc, skill) => ({ ...acc, [skill]: score }), {}),
          availability: 'immediately_available',
          job_search_status: 'actively_looking',
          location: `${country}, Remote`,
          integrity_clean: true,
          shareable_link_token: `token_${track}_${i + 1}`
        });
        await poolRepo.save(pool);

        count++;
      }
    }

    console.log(`[TalentSeeder] Seeded ${count} job-ready talents across all tracks.`);
  }
};
