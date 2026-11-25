import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AccountMode } from '@broker/shared';
import { requireAuth } from '../infrastructure/authMiddleware';
import { getPrisma } from '../infrastructure/database';
import { ACADEMY_MODULES } from '../services/ai-coach/indianMarketKnowledgeBase';
import { askAiTradingCoach } from '../services/ai-coach/coachService';
import {
  evaluatePracticeMissions,
  generateTradingDiagnostics,
} from '../services/ai-coach/tradeBehaviorDiagnostics';

const ChatBody = z.object({
  accountMode: z.enum(['DEMO', 'REAL']).default('DEMO'),
  question: z.string().min(2).max(1500),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
    .max(12)
    .optional(),
});

const SubmitQuizBody = z.object({
  answers: z.array(z.number().int().min(0).max(10)).min(1),
});

export async function coachRoutes(app: FastifyInstance) {
  // Interactive AI Trading Coach Q&A (Local RAG / Fine-Tuned Ollama / Gemini + SEBI Guardrail)
  app.post('/chat', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Please enter a valid question (2–1500 chars).' });
    }
    return askAiTradingCoach({
      userId: req.authUser!.id,
      accountMode: parsed.data.accountMode as AccountMode,
      question: parsed.data.question,
      history: parsed.data.history,
    });
  });

  // Personal Trade Behavior Diagnostics & DEMO->REAL Readiness Scorecard
  app.get<{ Querystring: { mode?: string } }>('/diagnostics', { preHandler: [requireAuth] }, async (req) => {
    const mode = (req.query.mode?.toUpperCase() === 'REAL' ? 'REAL' : 'DEMO') as AccountMode;
    return generateTradingDiagnostics(req.authUser!.id, mode);
  });

  // Hands-on DEMO Practice Missions (auto-verified against Prisma DB)
  app.get('/missions', { preHandler: [requireAuth] }, async (req) => {
    const missions = await evaluatePracticeMissions(req.authUser!.id);
    const completedCount = missions.filter((m) => m.completed).length;
    return {
      completedCount,
      totalCount: missions.length,
      missions,
    };
  });

  // 6-Module Beginner-to-Pro Indian Market Academy Curriculum + User Completion Progress
  app.get('/curriculum', { preHandler: [requireAuth] }, async (req) => {
    const progressRows = await getPrisma().userLearningProgress.findMany({
      where: { userId: req.authUser!.id },
    });
    const byId = new Map(progressRows.map((p) => [p.moduleId, p]));

    return {
      modules: ACADEMY_MODULES.map((m) => {
        const prog = byId.get(m.id);
        return {
          ...m,
          status: prog?.status ?? 'NOT_STARTED',
          quizScore: prog?.quizScore ?? null,
          completedAt: prog?.completedAt?.toISOString() ?? null,
        };
      }),
    };
  });

  // Grade Module Quiz & Persist Completion Progress
  app.post<{ Params: { moduleId: string } }>(
    '/curriculum/:moduleId/quiz',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const mod = ACADEMY_MODULES.find((m) => m.id === req.params.moduleId);
      if (!mod) return reply.status(404).send({ error: 'Academy module not found' });

      const parsed = SubmitQuizBody.safeParse(req.body);
      if (!parsed.success || parsed.data.answers.length !== mod.quiz.length) {
        return reply.status(400).send({ error: `Expected ${mod.quiz.length} quiz answers.` });
      }

      let correct = 0;
      const feedback = mod.quiz.map((q, idx) => {
        const chosen = parsed.data.answers[idx];
        const isCorrect = chosen === q.correctIndex;
        if (isCorrect) correct++;
        return {
          questionId: q.id,
          isCorrect,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
        };
      });

      const scorePct = Math.round((correct / mod.quiz.length) * 100);
      const passed = scorePct >= 50;

      await getPrisma().userLearningProgress.upsert({
        where: {
          userId_moduleId: { userId: req.authUser!.id, moduleId: mod.id },
        },
        create: {
          userId: req.authUser!.id,
          moduleId: mod.id,
          status: passed ? 'COMPLETED' : 'IN_PROGRESS',
          quizScore: scorePct,
          completedAt: passed ? new Date() : null,
        },
        update: {
          status: passed ? 'COMPLETED' : 'IN_PROGRESS',
          quizScore: scorePct,
          completedAt: passed ? new Date() : null,
        },
      });

      return {
        moduleId: mod.id,
        correct,
        total: mod.quiz.length,
        scorePct,
        passed,
        feedback,
      };
    }
  );
}
