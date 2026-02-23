import { Router, Response } from 'express';
import { authenticateApiKey, AuthenticatedRequest } from '../middleware/auth';
import { submitReport } from '../services/reports';

const router = Router();

/**
 * POST /reports
 * Gateway submits a behavior report about an agent's actions.
 * Authenticated with the gateway owner's developer API key.
 */
router.post('/', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId, gatewayId, actions, certificateJti } = req.body;

    // Validate required fields
    if (!agentId) {
      res.status(400).json({ success: false, error: 'agentId required' });
      return;
    }

    if (!gatewayId) {
      res.status(400).json({ success: false, error: 'gatewayId required' });
      return;
    }

    if (!Array.isArray(actions) || actions.length === 0) {
      res.status(400).json({ success: false, error: 'actions array required and must not be empty' });
      return;
    }

    if (!certificateJti) {
      res.status(400).json({ success: false, error: 'certificateJti required' });
      return;
    }

    // Validate each action in the array
    for (const action of actions) {
      if (!action.actionType) {
        res.status(400).json({ success: false, error: 'Each action must have an actionType' });
        return;
      }
      if (!action.outcome || !['success', 'failure'].includes(action.outcome)) {
        res.status(400).json({ success: false, error: 'Each action outcome must be "success" or "failure"' });
        return;
      }
    }

    const result = await submitReport({ agentId, gatewayId, actions, certificateJti, developerId: req.developer?.id });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Report submission failed';
    console.error('Report error:', error);
    res.status(400).json({ success: false, error: message });
  }
});

export default router;
