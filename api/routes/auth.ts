import { Router, type Request, type Response } from 'express';
import { getUserByUsername, getUserById } from '../services.js';
import { createAudit } from '../audit.js';

const router = Router();

function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

router.post('/login', (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: '用户名和密码不能为空',
      });
    }

    const user = getUserByUsername(username);
    const ip = getClientIp(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: '用户不存在',
      });
    }

    if (user.password !== password) {
      const auditUser = { ...user, role: user.role };
      createAudit(auditUser, 'LOGIN_FAILED', 'USER', user.id, false, {
        failureReason: '密码错误',
        ipAddress: ip,
      });
      return res.status(401).json({
        success: false,
        error: '密码错误',
      });
    }

    req.session.userId = user.id;
    createAudit(user, 'LOGIN', 'USER', user.id, true, {
      ipAddress: ip,
    });

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        department: user.department,
      },
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: '登录失败',
    });
  }
});

router.get('/me', (req: Request, res: Response) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({
        success: false,
        error: '未登录',
      });
    }
    const user = getUserById(req.session.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: '用户不存在',
      });
    }
    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        department: user.department,
      },
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: '获取用户信息失败',
    });
  }
});

router.post('/logout', (req: Request, res: Response) => {
  if (req.session.userId) {
    const user = getUserById(req.session.userId);
    if (user) {
      createAudit(user, 'LOGOUT', 'USER', user.id, true, {
        ipAddress: getClientIp(req),
      });
    }
  }
  req.session = null;
  res.json({
    success: true,
    message: '已登出',
  });
});

export default router;
