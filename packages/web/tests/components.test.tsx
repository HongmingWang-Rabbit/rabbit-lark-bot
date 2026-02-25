import { render, screen } from '@testing-library/react';

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
      },
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
    expect(screen.getByText('总任务数')).toBeInTheDocument();
    expect(screen.getByText('待办任务')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('管理员')).toBeInTheDocument();
  });

  it('displays correct stat values', () => {
    render(<Dashboard />);
    
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
