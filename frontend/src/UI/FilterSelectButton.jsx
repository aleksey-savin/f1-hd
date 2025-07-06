import ToggleButton from 'react-bootstrap/ToggleButton';

import Col from 'react-bootstrap/Col';
import Badge from 'react-bootstrap/Badge';

const FilterSelectButton = (props) => {
    return (
        <Col sm='auto'>
            <ToggleButton
                className='w-100 mb-3'
                id={'toggle-check-' + props.value}
                type='checkbox'
                size={props.size}
                value={props.value}
                variant={props.variant}
                checked={props.checked}
                onChange={props.filterSelectHandler}
            >
                {props.content}{' '}
                {props.length && <Badge bg='dark'>{props.length}</Badge>}
            </ToggleButton>
        </Col>
    );
};

export default FilterSelectButton;
