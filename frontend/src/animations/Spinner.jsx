import CircleLoader from 'react-spinners/CircleLoader';

import Row from 'react-bootstrap/Row';

const Spinner = () => {
    return (
        <Row
            style={{ height: '100vh' }}
            className='d-flex align-items-center justify-content-center'
        >
            <CircleLoader
                className='align-middle'
                loading={true}
                size={100}
                color='#19B497'
            />
        </Row>
    );
};

export default Spinner;
