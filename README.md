# HD Monorepo

This repository contains a comprehensive business management system migrated from three separate GitLab projects into a unified monorepo structure.

## 🏗️ Architecture

The system consists of three main applications:

```
hd/
├── backend/          # Node.js/Express API server
├── frontend/         # React/Vite web application
├── telegram-bot/     # Telegram bot service
├── compose.dev.yml   # Development Docker Compose
├── compose.prod.yml  # Production Docker Compose
├── deploy-prod.sh    # Production deployment script
├── env/             # Environment configurations
├── logs/            # Application logs
└── uploads/         # File uploads storage
```

## 🚀 Quick Start

### Prerequisites

- Node.js (v18 or higher)
- Docker and Docker Compose
- pnpm package manager

### Environment Setup

1. **Copy environment files:**
   ```bash
   cp .env.dev.example .env.dev
   cp .env.prod.example .env.prod
   ```

2. **Configure environment variables:**
   Edit `.env.dev` and `.env.prod` with your actual values:
   - Database credentials
   - API keys
   - Service URLs
   - JWT secrets

### Development

#### Option 1: Docker Compose (Recommended)

```bash
# Start all services
docker-compose -f compose.dev.yml up

# Start specific services
docker-compose -f compose.dev.yml up backend frontend
```

#### Option 2: Manual Setup

```bash
# Backend
cd backend
pnpm install
pnpm run dev

# Frontend (new terminal)
cd frontend
pnpm install
pnpm run dev

# Telegram Bot (new terminal)
cd telegram-bot
pnpm install
pnpm run dev
```

### Production

```bash
# Deploy to production
./deploy-prod.sh

# Or using Docker Compose
docker-compose -f compose.prod.yml up -d
```

## 📋 Features

### Backend API
- RESTful API with Express.js
- JWT authentication
- Database models and migrations
- File upload handling
- Email notifications
- Cron jobs and routine tasks
- Comprehensive logging

### Frontend Web App
- Modern React application with Vite
- Responsive design with Bootstrap
- Dark/Light theme support
- Real-time notifications
- File management
- Dashboard and analytics
- Mobile-responsive interface

### Telegram Bot
- Automated notifications
- Task management integration
- User interaction handling
- Webhook support

## 🛠️ Development Guidelines

### Code Structure

Each service follows these conventions:

**Backend:**
- `controllers/` - Request handlers
- `models/` - Database models
- `routes/` - API routes
- `middleware/` - Custom middleware
- `utils/` - Utility functions
- `validations/` - Input validation

**Frontend:**
- `src/components/` - React components
- `src/pages/` - Page components
- `src/hooks/` - Custom hooks
- `src/UI/` - Reusable UI components
- `src/css/` - Stylesheets

### Environment Variables

Never commit actual environment files! Use the example files as templates:

- `.env.dev.example` - Development environment template
- `.env.prod.example` - Production environment template

### Git Workflow

1. Create feature branches from `main`
2. Make atomic commits with descriptive messages
3. Test thoroughly before merging
4. Use conventional commit messages

## 🔧 Available Scripts

### Root Level
```bash
# Start all services in development
docker-compose -f compose.dev.yml up

# Start all services in production
docker-compose -f compose.prod.yml up -d

# Deploy to production
./deploy-prod.sh
```

### Individual Services
```bash
# Backend
cd backend
pnpm run dev        # Development server
pnpm run start      # Production server
pnpm run test       # Run tests
pnpm run lint       # Lint code

# Frontend
cd frontend
pnpm run dev        # Development server
pnpm run build      # Production build
pnpm run preview    # Preview production build
pnpm run lint       # Lint code

# Telegram Bot
cd telegram-bot
pnpm run dev        # Development server
pnpm run start      # Production server
```

## 📊 Monitoring & Logs

- Application logs: `logs/` directory
- Error tracking: Built-in logging middleware
- Performance monitoring: Available through dashboard

## 🔒 Security

- Environment variables are properly secured
- JWT token authentication
- Input validation and sanitization
- File upload restrictions
- Rate limiting implemented

## 🚀 Deployment

### Production Deployment

1. **Configure production environment:**
   ```bash
   cp .env.prod.example .env.prod
   # Edit .env.prod with production values
   ```

2. **Run deployment script:**
   ```bash
   ./deploy-prod.sh
   ```

### Docker Deployment

The system is fully containerized and can be deployed using Docker:

```bash
# Production deployment
docker-compose -f compose.prod.yml up -d

# Check status
docker-compose -f compose.prod.yml ps

# View logs
docker-compose -f compose.prod.yml logs -f
```

## 📈 Monitoring

- Health checks available at `/health` endpoints
- Comprehensive logging system
- Error tracking and reporting
- Performance metrics collection

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run linting and tests
6. Submit a pull request

## 📄 License

This project is proprietary software. All rights reserved.

## 🆘 Support

For support and questions:
- Check the logs in `logs/` directory
- Review environment configuration
- Consult the API documentation
- Contact the development team

---

**Note:** This is a monorepo containing three integrated applications. Each service can be developed and deployed independently while maintaining shared configurations and resources.