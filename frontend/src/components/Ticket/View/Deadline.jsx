import { formatDate } from '../../../util/format-date';

import Col from 'react-bootstrap/Col';

const Deadline = (props) => {
    
    return (
        <>
            {props.isOverdue &&
                props.ticket.state !== 'Закрыта' &&
                props.ticket.state !== 'Выполнена' && (
                    <Col xl={6}>
                        <p style={{ color: '#e74c3c' }}>
                            <strong>Дедлайн:</strong>{' '}
                            {formatDate(props.ticket.deadline)}
                        </p>
                    </Col>
                )}
            {(!props.isOverdue ||
                props.ticket.state === 'Закрыта' ||
                props.ticket.state === 'Выполнена') && (
                <Col xl={6}>
                    <p>
                        <strong>Дедлайн:</strong>{' '}
                        {formatDate(props.ticket.deadline)}
                    </p>
                </Col>
            )}
        </>
    );
};

export default Deadline;
