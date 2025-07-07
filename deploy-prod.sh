#!/bin/bash

# HD System Production Deployment Script with Performance Optimizations
# This script deploys the application with all performance enhancements

set -e

# Performance optimization environment variables
export NODE_ENV=production
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
export COMPOSE_HTTP_TIMEOUT=300

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check dependencies
check_dependencies() {
    log_info "Checking dependencies..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi

    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not available"
        exit 1
    fi

    log_success "Dependencies check passed"
}

# Function to validate environment
validate_environment() {
    log_info "Validating environment..."

    if [ ! -f .env.prod ]; then
        log_error "Environment file .env.prod not found!"
        exit 1
    fi

    # Check for required environment variables
    required_vars=("MONGODB_USERNAME" "MONGODB_PASSWORD" "JWT_SECRET" "API_URL")
    for var in "${required_vars[@]}"; do
        if ! grep -q "^${var}=" .env.prod; then
            log_error "Required environment variable ${var} not found in .env.prod"
            exit 1
        fi
    done

    log_success "Environment validation passed"
}

# Function to setup Docker volumes
setup_volumes() {
    log_info "Setting up Docker volumes..."

    # Create external volumes if they don't exist
    docker volume create hd_data 2>/dev/null || true
    docker volume create hd_mongodb_config 2>/dev/null || true
    docker volume create hd_uploads 2>/dev/null || true

    log_success "Docker volumes ready"
}

# Function to cleanup Docker resources
cleanup_docker() {
    log_info "Cleaning up Docker resources for optimal performance..."

    # Remove unused containers and networks
    docker system prune -f 2>/dev/null || true

    # Clear builder cache to prevent build issues
    docker builder prune -f 2>/dev/null || true

    log_success "Docker cleanup completed"
}

# Function to build with performance optimizations
build_optimized() {
    log_info "Building application with performance optimizations..."

    # Set build-time performance flags
    export DOCKER_BUILDKIT=1
    export BUILDKIT_PROGRESS=plain

    # Build with no cache and parallel processing
    if ! docker compose -f compose.prod.yml build --no-cache --parallel; then
        log_error "Build failed"
        exit 1
    fi

    log_success "Build completed successfully"
}

# Function to start services with health checks
start_services() {
    log_info "Starting optimized production services..."

    # Stop existing containers gracefully
    docker compose -f compose.prod.yml down --remove-orphans 2>/dev/null || true

    # Start all services
    docker compose -f compose.prod.yml up -d

    log_success "Services started"
}

# Function to wait for service health
wait_for_health() {
    local service=$1
    local max_attempts=30
    local attempt=0

    log_info "Waiting for $service to be healthy..."

    while [ $attempt -lt $max_attempts ]; do
        if docker compose -f compose.prod.yml ps $service | grep -q "healthy"; then
            log_success "$service is healthy"
            return 0
        fi

        attempt=$((attempt + 1))
        sleep 2
    done

    log_error "$service failed to become healthy"
    return 1
}

# Function to check API response times
check_performance() {
    log_info "Checking API performance..."

    # Wait a bit for services to fully start
    sleep 5

    # Test API response time
    if command -v curl &> /dev/null; then
        local response_time=$(curl -o /dev/null -s -w "%{time_total}" http://localhost:8080/health 2>/dev/null || echo "0")

        if [ "$response_time" != "0" ]; then
            # Convert to milliseconds for easier reading
            local ms_time=$(echo "$response_time * 1000" | bc -l 2>/dev/null || echo "0")

            if (( $(echo "$response_time < 1.0" | bc -l 2>/dev/null) )); then
                log_success "API response time: ${ms_time}ms (Good)"
            else
                log_warning "API response time: ${ms_time}ms (Consider further optimization)"
            fi
        else
            log_warning "Could not measure API response time"
        fi
    fi
}

# Function to show resource usage
show_resources() {
    log_info "Container resource usage:"

    # Get container IDs
    local container_ids=$(docker compose -f compose.prod.yml ps -q 2>/dev/null)

    if [ -n "$container_ids" ]; then
        docker stats $container_ids --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
    else
        log_warning "No containers found"
    fi
}

# Function to show service status
show_status() {
    log_info "Service status:"
    docker compose -f compose.prod.yml ps

    echo ""
    log_info "Service health:"
    for service in mongodb backend frontend telegram-bot; do
        if docker compose -f compose.prod.yml ps $service | grep -q "healthy"; then
            log_success "$service: healthy"
        elif docker compose -f compose.prod.yml ps $service | grep -q "Up"; then
            log_warning "$service: running (no health check)"
        else
            log_error "$service: not running"
        fi
    done
}

# Function to show logs
show_logs() {
    log_info "Recent service logs:"
    docker compose -f compose.prod.yml logs --tail=50
}

# Function to create performance report
create_performance_report() {
    log_info "Generating performance report..."

    local report_file="performance_report_$(date +%Y%m%d_%H%M%S).txt"

    {
        echo "HD System Performance Report"
        echo "Generated: $(date)"
        echo "================================"
        echo ""

        echo "Service Status:"
        docker compose -f compose.prod.yml ps
        echo ""

        echo "Resource Usage:"
        local container_ids=$(docker compose -f compose.prod.yml ps -q 2>/dev/null)
        if [ -n "$container_ids" ]; then
            docker stats $container_ids --no-stream
        fi
        echo ""

        echo "Backend Health Check:"
        curl -s http://localhost:8080/health 2>/dev/null || echo "Health check failed"
        echo ""

        echo "Disk Usage:"
        df -h
        echo ""

        echo "Docker System Info:"
        docker system df

    } > "$report_file"

    log_success "Performance report saved to $report_file"
}

# Function to show help
show_help() {
    echo "HD System Production Deployment Script"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  deploy    - Full deployment with performance optimizations"
    echo "  start     - Start services"
    echo "  stop      - Stop services"
    echo "  restart   - Restart services"
    echo "  status    - Show service status and health"
    echo "  logs      - Show service logs"
    echo "  stats     - Show resource usage"
    echo "  health    - Check service health"
    echo "  report    - Generate performance report"
    echo "  cleanup   - Clean up Docker resources"
    echo "  help      - Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 deploy   # Full optimized deployment"
    echo "  $0 status   # Check service status"
    echo "  $0 stats    # Show resource usage"
}

# Main deployment function
deploy() {
    log_info "🚀 Starting HD System Production Deployment with Performance Optimizations..."

    check_dependencies
    validate_environment
    setup_volumes
    cleanup_docker
    build_optimized
    start_services

    # Wait for critical services
    wait_for_health "mongodb" || exit 1
    wait_for_health "backend" || exit 1
    wait_for_health "frontend" || exit 1

    # Performance checks
    check_performance
    show_resources
    show_status

    log_success "🎉 Deployment completed successfully!"
    log_info "Frontend: http://localhost:81"
    log_info "Backend API: http://localhost:8080"
    log_info "Health Check: http://localhost:8080/health"
}

# Main script logic
case "${1:-deploy}" in
    "deploy")
        deploy
        ;;
    "start")
        start_services
        ;;
    "stop")
        log_info "Stopping services..."
        docker compose -f compose.prod.yml down
        log_success "Services stopped"
        ;;
    "restart")
        log_info "Restarting services..."
        docker compose -f compose.prod.yml down
        docker compose -f compose.prod.yml up -d
        log_success "Services restarted"
        ;;
    "status")
        show_status
        ;;
    "logs")
        show_logs
        ;;
    "stats")
        show_resources
        ;;
    "health")
        for service in mongodb backend frontend telegram-bot; do
            wait_for_health "$service" || true
        done
        ;;
    "report")
        create_performance_report
        ;;
    "cleanup")
        cleanup_docker
        ;;
    "help"|"--help"|"-h")
        show_help
        ;;
    *)
        log_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
