import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock auth — always authed for component tests
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    authed: true,
    user: { userId: 'test', name: 'Test', role: 'superadmin', avatarUrl: null },
    loading: false,
    loginWithPassword: jest.fn(),
    logout: jest.fn(),
    feishuOAuthUrl: '/api/auth/feishu',
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock SWR
jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({
    data: {
      stats: {
        totalTasks: 10,
        pendingTasks: 3,
        completedTasks: 7,
        adminCount: 2,
        totalUsers: 5,
      },
      builtinEnabled: true,
      recentActivity: [],
    },
    error: null,
    isLoading: false,
  }),
  mutate: jest.fn(),
}));

// Import after mocking
import Dashboard from '@/app/page';

describe('Dashboard', () => {
  it('renders stats cards', () => {
    render(<Dashboard />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('注册用户')).toBeInTheDocument();
    expect(screen.getByText('待办任务')).toBeInTheDocument();
    expect(screen.getByText('已完成任务')).toBeInTheDocument();
    expect(screen.getByText('管理员')).toBeInTheDocument();
  });

  it('displays correct stat values', () => {
    render(<Dashboard />);

    expect(screen.getByText('5')).toBeInTheDocument();  // totalUsers
    expect(screen.getByText('3')).toBeInTheDocument();  // pendingTasks
    expect(screen.getByText('7')).toBeInTheDocument();  // completedTasks
    expect(screen.getByText('2')).toBeInTheDocument();  // adminCount
  });
});
