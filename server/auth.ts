import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from 'database';

const jwtSecretEnv = process.env.JWT_SECRET;
if (!jwtSecretEnv) {
  throw new Error('JWT_SECRET environment variable is required');
}
const JWT_SECRET: string = jwtSecretEnv;

const BCRYPT_SALT_ROUNDS = 10;

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const existing = await prisma.account.findUnique({ where: { username } });
  if (existing) {
    res.status(409).json({ error: 'username is already taken' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  const account = await prisma.account.create({
    data: {
      username,
      passwordHash,
      characters: {
        create: {
          name: username,
          x: 0,
          y: 0,
          inventoryItems: {
            create: { itemId: 'health_potion', slotIndex: 0, quantity: 5 },
          },
        },
      },
    },
  });

  res.status(201).json({ id: account.id, username: account.username });
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const account = await prisma.account.findUnique({ where: { username } });
  if (!account) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  const passwordMatches = await bcrypt.compare(password, account.passwordHash);
  if (!passwordMatches) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  const token = jwt.sign({ accountId: account.id }, JWT_SECRET, { expiresIn: '7d' });

  res.json({ token });
});
