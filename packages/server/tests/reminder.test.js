// Mock logger
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Mock pool
const mockQuery = jest.fn();
const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};
jest.mock('../src/db/pool', () => ({
  query: (...args) => mockQuery(...args),
  connect: jest.fn().mockResolvedValue(mockClient),
}));

// Mock audit
jest.mock('../src/db', () => ({
  audit: {
    log: jest.fn().mockResolvedValue(null),
  },
}));

// Mock feishu client
jest.mock('../src/feishu/client', () => ({
  sendMessage: jest.fn().mockResolvedValue({}),
}));

const reminderService = require('../src/services/reminder');
const feishu = require('../src/feishu/client');
const { audit } = require('../src/db');

describe('Reminder Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
  });

  describe('getAllTasks', () => {
    it('should return tasks ordered by created_at DESC', async () => {
      const mockTasks = [
        { id: 2, title: 'Task B', status: 'pending' },
        { id: 1, title: 'Task A', status: 'completed' },
      ];
      mockQuery.mockResolvedValueOnce({ rows: mockTasks });

      const tasks = await reminderService.getAllTasks();
      expect(tasks).toEqual(mockTasks);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        [100]
      );
    });

    it('should respect custom limit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await reminderService.getAllTasks(50);
      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [50]);
    });
  });

  describe('getAllPendingTasks', () => {
    it('should return only pending tasks', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, status: 'pending' }] });
      const tasks = await reminderService.getAllPendingTasks();
      expect(tasks).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'pending'")
      );
    });
  });

  describe('getUserPendingTasks', () => {
    it('should query by feishu_user_id and open_id', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await reminderService.getUserPendingTasks('user_123', 'ou_456');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('assignee_id'),
        ['user_123', 'ou_456']
      );
    });

    it('should handle null feishu_user_id', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await reminderService.getUserPendingTasks(null, 'ou_456');
      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [null, 'ou_456']);
    });
  });

  describe('createTask', () => {
    it('should insert a task and return it', async () => {
      const mockTask = { id: 1, title: 'Test', status: 'pending', assignee_open_id: 'ou_123' };
      mockQuery.mockResolvedValueOnce({ rows: [mockTask] });

      const task = await reminderService.createTask({
        title: 'Test',
        assigneeId: 'user_123',
        assigneeOpenId: 'ou_123',
        creatorId: 'creator_1',
      });

      // createTask spreads the DB row and augments with assignee_name —
      // use toMatchObject so extra fields don't cause a false failure.
      expect(task).toMatchObject(mockTask);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tasks'),
        expect.arrayContaining(['Test', 'user_123', 'ou_123'])
      );
    });

    it('should log to audit when creatorId is provided', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, title: 'Test' }] });
      await reminderService.createTask({
        title: 'Test',
        assigneeId: 'user_123',
        creatorId: 'creator_1',
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create_task', userId: 'creator_1' })
      );
    });

    it('should not log to audit when creatorId is missing', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, title: 'Test' }] });
      await reminderService.createTask({ title: 'Test', assigneeId: 'user_123' });
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('should notify assignee via Feishu when assigneeOpenId is provided', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, title: 'Test' }] });
      await reminderService.createTask({
        title: 'Test',
        assigneeId: 'user_123',
        assigneeOpenId: 'ou_123',
      });
      expect(feishu.sendMessage).toHaveBeenCalledWith('ou_123', expect.any(String), 'open_id');
    });

    it('should use default deadline when none provided', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, title: 'Test' }] });
      await reminderService.createTask({ title: 'Test', assigneeId: 'user_123' });

      const insertCall = mockQuery.mock.calls[0];
      const deadlineArg = insertCall[1][4]; // 5th param is deadline
      expect(deadlineArg).toBeInstanceOf(Date);
    });

    it('should reject invalid deadline string', async () => {
      await expect(
        reminderService.createTask({ title: 'Test', assigneeId: 'user_123', deadline: 'not-a-date' })
      ).rejects.toThrow('Invalid deadline date');
    });

    it('should accept YYYY-MM-DD deadline format', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, title: 'Test' }] });
      await reminderService.createTask({ title: 'Test', assigneeId: 'user_123', deadline: '2026-06-15' });

      const insertCall = mockQuery.mock.calls[0];
      const deadlineArg = insertCall[1][4];
      expect(deadlineArg).toBeInstanceOf(Date);
      expect(deadlineArg.getFullYear()).toBe(2026);
      expect(deadlineArg.getMonth()).toBe(5); // June = 5
      expect(deadlineArg.getDate()).toBe(15);
    });
  });

  describe('completeTask', () => {
    it('should mark task as completed', async () => {
      const mockTask = { id: 1, title: 'Test', status: 'completed', reporter_open_id: null };
      mockQuery.mockResolvedValueOnce({ rows: [mockTask] });

      const task = await reminderService.completeTask(1, 'proof-url', 'user_123');
      expect(task).toEqual(mockTask);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'completed'"),
        [1, 'proof-url']
      );
    });

    it('should return null when task not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await reminderService.completeTask(999);
      expect(result).toBeNull();
    });

    it('should notify reporter when reporter_open_id is set', async () => {
      const mockTask = { id: 1, title: 'Test', reporter_open_id: 'ou_reporter' };
      mockQuery.mockResolvedValueOnce({ rows: [mockTask] });

      await reminderService.completeTask(1, '', 'user_123', 'Completer Name');
      expect(feishu.sendMessage).toHaveBeenCalledWith(
        'ou_reporter',
        expect.stringContaining('已完成'),
        'open_id'
      );
    });

    it('should not notify when no reporter_open_id', async () => {
      const mockTask = { id: 1, title: 'Test', reporter_open_id: null };
      mockQuery.mockResolvedValueOnce({ rows: [mockTask] });

      await reminderService.completeTask(1);
      expect(feishu.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('deleteTask', () => {
    it('should delete a task and return it', async () => {
      const mockTask = { id: 1, title: 'Test' };
      mockQuery.mockResolvedValueOnce({ rows: [mockTask] });

      const task = await reminderService.deleteTask(1, 'user_123');
      expect(task).toEqual(mockTask);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM tasks'),
        [1]
      );
    });

    it('should log to audit when userId is provided', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      await reminderService.deleteTask(1, 'user_123');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete_task' })
      );
    });
  });

  describe('sendPendingReminders', () => {
    it('should return 0 when no tasks are due', async () => {
      // Part 1: BEGIN + SELECT overdue → empty
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT overdue
        .mockResolvedValueOnce({}) // COMMIT
        // Part 2: BEGIN + SELECT interval → empty
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT interval
        .mockResolvedValueOnce({}); // COMMIT

      const count = await reminderService.sendPendingReminders();
      expect(count).toBe(0);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should send overdue alerts and return count', async () => {
      const overdueTasks = [
        { id: 1, title: 'Overdue 1', assignee_open_id: 'ou_1', reporter_open_id: 'ou_r1', deadline: new Date('2025-01-01'), reminder_interval_hours: 24 },
      ];

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: overdueTasks }) // SELECT overdue
        .mockResolvedValueOnce({}) // UPDATE deadline_notified_at
        .mockResolvedValueOnce({}) // COMMIT
        // Part 2
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT interval
        .mockResolvedValueOnce({}); // COMMIT

      const count = await reminderService.sendPendingReminders();
      expect(count).toBe(1);
      expect(feishu.sendMessage).toHaveBeenCalledWith('ou_1', expect.stringContaining('逾期'), 'open_id');
      expect(feishu.sendMessage).toHaveBeenCalledWith('ou_r1', expect.stringContaining('逾期'), 'open_id');
    });

    it('should send interval reminders and return count', async () => {
      const intervalTasks = [
        { id: 2, title: 'Remind Me', assignee_open_id: 'ou_2', deadline: new Date('2026-12-31'), reminder_interval_hours: 24 },
      ];

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT overdue
        .mockResolvedValueOnce({}) // COMMIT
        // Part 2
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: intervalTasks }) // SELECT interval
        .mockResolvedValueOnce({}) // UPDATE last_reminded_at
        .mockResolvedValueOnce({}); // COMMIT

      const count = await reminderService.sendPendingReminders();
      expect(count).toBe(1);
      expect(feishu.sendMessage).toHaveBeenCalledWith('ou_2', expect.stringContaining('催办提醒'), 'open_id');
    });

    it('should rollback and release client on Part 1 error', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('DB error')) // SELECT fails
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(reminderService.sendPendingReminders()).rejects.toThrow('DB error');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should rollback and release client on Part 2 error', async () => {
      const pool = require('../src/db/pool');
      const mockClient2 = { query: jest.fn(), release: jest.fn() };

      // Part 1 succeeds
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT overdue
        .mockResolvedValueOnce({}); // COMMIT

      // Part 2 fails — need a fresh client
      pool.connect
        .mockResolvedValueOnce(mockClient) // Part 1
        .mockResolvedValueOnce(mockClient2); // Part 2

      mockClient2.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('Part 2 error')) // SELECT fails
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(reminderService.sendPendingReminders()).rejects.toThrow('Part 2 error');
      expect(mockClient2.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient2.release).toHaveBeenCalled();
    });
  });

  describe('constants', () => {
    it('should export DEFAULT_DEADLINE_DAYS', () => {
      expect(typeof reminderService.DEFAULT_DEADLINE_DAYS).toBe('number');
      expect(reminderService.DEFAULT_DEADLINE_DAYS).toBeGreaterThan(0);
    });

    it('should export DEFAULT_REMINDER_INTERVAL_HOURS', () => {
      expect(typeof reminderService.DEFAULT_REMINDER_INTERVAL_HOURS).toBe('number');
      expect(reminderService.DEFAULT_REMINDER_INTERVAL_HOURS).toBeGreaterThan(0);
    });
  });
});
