import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { containsProviderLeak } from '../infrastructure/providerAnonymizer';

describe('AI Trading Coach & Indian Market Beginner Academy API', () => {
  let app: FastifyInstance;
  let token = '';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `coach_${Date.now()}@example.in`,
        fullName: 'Beginner Learner',
        password: 'StrongPassword123',
        acceptSebiRiskDisclosure: true,
      },
    });
    token = reg.json().accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('enforces the SEBI IA/RA investment-advice refusal guardrail on stock tip requests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        accountMode: 'DEMO',
        question: 'Should I buy RELIANCE today for quick profit?',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(containsProviderLeak(res.body)).toBe(false);
    const body = res.json();
    expect(body.sebiGuardrailTriggered).toBe(true);
    expect(body.answer).toContain('SEBI');
    expect(body.suggestedActions.length).toBeGreaterThan(0);
  });

  it('answers grounded Indian market & platform questions with citations and zero provider leaks', async () => {
    const questions = [
      'What are the Finance Act 2026 STT rates and all trading charges?',
      'How does zero-look-ahead backtesting work in Strategy Lab?',
      'How do I verify my trades on the SHA-256 blockchain?',
    ];

    for (const question of questions) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/coach/chat',
        headers: { authorization: `Bearer ${token}` },
        payload: { accountMode: 'DEMO', question },
      });
      expect(res.statusCode).toBe(200);
      expect(containsProviderLeak(res.body)).toBe(false);
      const body = res.json();
      expect(body.sebiGuardrailTriggered).toBe(false);
      expect(body.citations.length).toBeGreaterThan(0);
      expect(body.answer.length).toBeGreaterThan(40);
    }
  });

  it('serves the 6-module curriculum, grades quizzes, persists completion, and auto-verifies DEMO missions & diagnostics', async () => {
    // 1. Fetch curriculum
    const currBefore = await app.inject({
      method: 'GET',
      url: '/api/v1/coach/curriculum',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(currBefore.statusCode).toBe(200);
    expect(containsProviderLeak(currBefore.body)).toBe(false);
    const modules = currBefore.json().modules;
    expect(modules.length).toBe(6);

    // 2. Submit passing quiz answers for Module 1 and Module 2
    const mod1 = modules[0];
    const q1 = await app.inject({
      method: 'POST',
      url: `/api/v1/coach/curriculum/${mod1.id}/quiz`,
      headers: { authorization: `Bearer ${token}` },
      payload: { answers: mod1.quiz.map((q: { correctIndex: number }) => q.correctIndex) },
    });
    expect(q1.statusCode).toBe(200);
    expect(q1.json().passed).toBe(true);
    expect(q1.json().scorePct).toBe(100);

    const mod2 = modules[1];
    const q2 = await app.inject({
      method: 'POST',
      url: `/api/v1/coach/curriculum/${mod2.id}/quiz`,
      headers: { authorization: `Bearer ${token}` },
      payload: { answers: mod2.quiz.map((q: { correctIndex: number }) => q.correctIndex) },
    });
    expect(q2.statusCode).toBe(200);
    expect(q2.json().passed).toBe(true);

    // 3. Fund DEMO account -> should automatically complete Mission 1 & Mission 5 (2 modules completed)
    await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/demo/balance',
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 200000 },
    });

    const missionsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/coach/missions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missionsRes.statusCode).toBe(200);
    expect(containsProviderLeak(missionsRes.body)).toBe(false);
    const missionsBody = missionsRes.json();
    expect(missionsBody.totalCount).toBe(5);
    expect(missionsBody.completedCount).toBeGreaterThanOrEqual(2);
    expect(missionsBody.missions.find((m: { id: string }) => m.id === 'mission-1-demo-fund').completed).toBe(true);
    expect(missionsBody.missions.find((m: { id: string }) => m.id === 'mission-5-academy').completed).toBe(true);

    // 4. Diagnostics & Readiness Score
    const diagRes = await app.inject({
      method: 'GET',
      url: '/api/v1/coach/diagnostics?mode=DEMO',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(diagRes.statusCode).toBe(200);
    expect(containsProviderLeak(diagRes.body)).toBe(false);
    const diag = diagRes.json();
    expect(diag.accountMode).toBe('DEMO');
    expect(diag.readinessScore).toBeGreaterThanOrEqual(0);
    expect(diag.readinessScore).toBeLessThanOrEqual(100);
    expect(diag.nextStepAdvice.length).toBeGreaterThan(10);
  });
});
