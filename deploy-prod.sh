#!/bin/bash

# Production Deployment Script for HD System
# This script helps deploy the HD system in production mode

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if required commands exist
check_dependencies() {
    print_status "Checking dependencies..."

    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed or not in PATH"
        exit 1
    fi

    if ! docker compose version &> /dev/null; then
        print_error "Docker Compose is not installed or not working"
        print_error "Please install Docker with Compose plugin"
        exit 1
    fi

    # Check BuildKit support
    if ! docker buildx version &> /dev/null; then
        print_warning "Docker BuildKit (buildx) not available, using legacy builder"
        export DOCKER_BUILDKIT=0
    else
        export DOCKER_BUILDKIT=1
    fi

    print_success "All dependencies are installed"
}

# Function to generate secure passwords
generate_password() {
    # Generate password with alphanumeric characters only to avoid sed issues
    tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 25
}

# Function to generate JWT secret
generate_jwt_secret() {
    # Generate JWT secret with alphanumeric characters only to avoid sed issues
    tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 64
}

# Function to setup environment file
setup_environment() {
    print_status "Setting up production environment..."

    if [ ! -f ".env.prod" ]; then
        print_error "Production environment file not found at .env.prod"
        exit 1
    fi

    # Generate secure passwords if placeholders exist
    if grep -q "your_secure_mongodb_password_here" .env.prod; then
        MONGODB_PASSWORD=$(generate_password)
        sed -i "s|your_secure_mongodb_password_here|${MONGODB_PASSWORD}|g" .env.prod
        print_success "Generated secure MongoDB password"
    fi

    if grep -q "your_very_secure_jwt_secret_key_here_minimum_256_bits" .env.prod; then
        JWT_SECRET=$(generate_jwt_secret)
        sed -i "s|your_very_secure_jwt_secret_key_here_minimum_256_bits|${JWT_SECRET}|g" .env.prod
        print_success "Generated secure JWT secret"
    fi

    if grep -q "your_session_secret_here" .env.prod; then
        SESSION_SECRET=$(generate_password)
        sed -i "s|your_session_secret_here|${SESSION_SECRET}|g" .env.prod
        print_success "Generated secure session secret"
    fi

    print_warning "Please review and update the following in .env.prod:"
    print_warning "- API_URL (set your actual domain)"
    print_warning "- TG_TOKEN (set your Telegram bot token)"
    print_warning "- TG_TOKEN"
    print_warning "- Domain-specific settings"

    read -p "Have you reviewed and updated .env.prod? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_error "Please update .env.prod before continuing"
        exit 1
    fi
}

# Function to create necessary directories
create_directories() {
    print_status "Creating necessary directories..."

    # Create directories for logs and uploads
    mkdir -p logs
    mkdir -p uploads
    mkdir -p backend/logs
    mkdir -p backend/uploads
    mkdir -p telegram-bot/logs

    # Set proper permissions
    chmod 755 logs uploads backend/logs backend/uploads telegram-bot/logs

    print_success "Directories created successfully"
}

# Function to build Docker images
build_images() {
    print_status "Building Docker images..."

    # Clean up builder cache to prevent BuildKit issues
    docker builder prune -f || true

    # Set BuildKit environment variables to prevent issues
    export DOCKER_BUILDKIT=1
    export BUILDKIT_PROGRESS=plain

    # Build all services with proper error handling
    if ! docker compose -f compose.prod.yml --env-file .env.prod build --no-cache --progress=plain; then
        print_error "Docker build failed. Trying with legacy builder..."
        export DOCKER_BUILDKIT=0
        docker compose -f compose.prod.yml --env-file .env.prod build --no-cache
    fi

    print_success "Docker images built successfully"
}

# Function to start services
start_services() {
    print_status "Starting services..."

    # Start services with environment file
    docker compose -f compose.prod.yml --env-file .env.prod up -d

    print_success "Services started successfully"
}

# Function to check service health
check_health() {
    print_status "Checking service health..."

    # Wait for services to be healthy
    local max_attempts=30
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if docker compose -f compose.prod.yml --env-file .env.prod ps | grep -q "healthy"; then
            print_success "Services are healthy"
            return 0
        fi

        attempt=$((attempt + 1))
        print_status "Waiting for services to be healthy... (attempt $attempt/$max_attempts)"
        sleep 10
    done

    print_error "Services did not become healthy within expected time"
    print_status "Checking service logs..."
    docker compose -f compose.prod.yml --env-file .env.prod logs -f
    return 1
}

# Function to show service status
show_status() {
    print_status "Current service status:"
    docker compose -f compose.prod.yml --env-file .env.prod ps

    print_status "Service logs (last 20 lines):"
    docker compose -f compose.prod.yml --env-file .env.prod logs --tail=20
}

# Function to check detailed service health
check_detailed_health() {
    print_status "Checking detailed service health..."

    # Check if services are running
    if ! docker compose -f compose.prod.yml --env-file .env.prod ps -q > /dev/null 2>&1; then
        print_error "No services are running"
        return 1
    fi

    # Check individual service health
    services=("mongodb" "backend" "frontend" "telegram-bot")

    for service in "${services[@]}"; do
        if docker compose -f compose.prod.yml --env-file .env.prod ps "$service" | grep -q "healthy"; then
            print_success "$service: healthy"
        elif docker compose -f compose.prod.yml --env-file .env.prod ps "$service" | grep -q "unhealthy"; then
            print_error "$service: unhealthy"
        elif docker compose -f compose.prod.yml --env-file .env.prod ps "$service" | grep -q "Up"; then
            print_warning "$service: running (no health check)"
        else
            print_error "$service: not running"
        fi
    done
}

# Function to execute commands in containers
exec_command() {
    if [ $# -lt 2 ]; then
        print_error "Usage: $0 exec SERVICE COMMAND"
        print_error "Example: $0 exec backend bash"
        return 1
    fi

    local service=$1
    shift
    print_status "Executing command in $service: $*"
    docker compose -f compose.prod.yml --env-file .env.prod exec "$service" "$@"
}

# Function to show resource statistics
show_stats() {
    print_status "Container resource usage:"
    local container_ids=$(docker compose -f compose.prod.yml --env-file .env.prod ps -q)
    if [ -n "$container_ids" ]; then
        docker stats $container_ids --no-stream
    else
        print_error "No containers are running"
    fi
}



# Function to create backup
create_backup() {
    print_status "Creating backup..."

    local backup_dir="backups/$(date +%Y-%m-%d_%H-%M-%S)"
    mkdir -p "$backup_dir"

    # Backup MongoDB
    docker compose -f compose.prod.yml --env-file .env.prod exec -T mongodb mongodump --out /tmp/backup
    docker cp $(docker compose -f compose.prod.yml --env-file .env.prod ps -q mongodb):/tmp/backup "$backup_dir/mongodb"

    # Backup uploads
    if [ -d "backend/uploads" ]; then
        cp -r backend/uploads "$backup_dir/"
    fi

    # Backup environment file
    cp .env.prod "$backup_dir/"

    print_success "Backup created at $backup_dir"
}

# Function to stop services
stop_services() {
    print_status "Stopping services..."
    docker compose -f compose.prod.yml --env-file .env.prod down
    print_success "Services stopped"
}

# Function to clean up
cleanup() {
    print_status "Cleaning up..."

    # Remove stopped containers
    docker container prune -f

    # Remove unused images
    docker image prune -f

    # Remove builder cache to prevent BuildKit issues
    if command -v docker buildx &> /dev/null; then
        docker builder prune -f
    fi

    # Remove unused volumes (be careful with this)
    read -p "Do you want to remove unused volumes? This will delete data! (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker volume prune -f
        print_success "Unused volumes removed"
    fi

    print_success "Cleanup completed"
}

# Function to show help
show_help() {
    echo "HD System Production Deployment Script"
    echo
    echo "Usage: $0 [COMMAND]"
    echo
    echo "Commands:"
    echo "  deploy    - Full deployment (setup, build, start)"
    echo "  start     - Start services"
    echo "  stop      - Stop services"
    echo "  restart   - Restart services"
    echo "  status    - Show service status"
    echo "  logs      - Show service logs"
    echo "  health    - Check detailed service health"
    echo "  exec      - Execute command in service"
    echo "  stats     - Show resource usage"
    echo "  backup    - Create backup"
    echo "  cleanup   - Clean up Docker resources"
    echo "  help      - Show this help message"
    echo
    echo "Examples:"
    echo "  $0 deploy   # Full deployment"
    echo "  $0 start    # Start services"
    echo "  $0 status   # Check status"
    echo "  $0 health   # Check service health"
    echo "  $0 exec backend bash  # Shell into backend"
    echo "  $0 stats    # Show resource usage"
}

# Main script logic
main() {
    case "${1:-}" in
        "deploy")
            check_dependencies
            setup_environment
            create_directories
            build_images
            start_services
            check_health
            show_status
            print_success "Deployment completed successfully!"

            ;;
        "start")
            docker compose -f compose.prod.yml --env-file .env.prod up -d
            ;;
        "stop")
            stop_services
            ;;
        "restart")
            stop_services
            docker compose -f compose.prod.yml --env-file .env.prod up -d
            ;;
        "status")
            show_status
            ;;
        "logs")
            docker compose -f compose.prod.yml --env-file .env.prod logs -f
            ;;
        "backup")
            create_backup
            ;;
        "cleanup")
            cleanup
            ;;
        "health")
            check_detailed_health
            ;;
        "exec")
            shift
            exec_command "$@"
            ;;
        "stats")
            show_stats
            ;;
        "help"|"--help"|"-h")
            show_help
            ;;
        *)
            print_error "Unknown command: ${1:-}"
            echo
            show_help
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
