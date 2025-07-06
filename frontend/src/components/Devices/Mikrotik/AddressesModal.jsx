import { useState } from 'react';

import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';

const MikrotikAddressesModal = (props) => {
    const [show, setShow] = useState(false);

    const handleClose = () => setShow(false);
    const handleShow = () => setShow(true);
    return (
        <>
            <Button variant='primary' onClick={handleShow}>
                Просмотреть
            </Button>

            <Modal show={show} onHide={handleClose} centered size='lg'>
                <Modal.Header closeButton>
                    <Modal.Title>Подсети</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <table className='table-responsive sortable'>
                        <thead>
                            <tr>
                                <th>Address</th>
                                <th>Network</th>
                                <th>Interface</th>
                                <th>Comment</th>
                            </tr>
                        </thead>
                        <tbody className='table-round-bottom'>
                            {props.device.addresses
                                .filter((item) => item.network)
                                .map((item) => (
                                    <tr key={item._id}>
                                        <td data-cell='address'>
                                            {item.address}
                                        </td>
                                        <td data-cell='network'>
                                            {item.network}
                                        </td>
                                        <td data-cell='interface'>
                                            {item.interface}
                                        </td>
                                        <td data-cell='comment'>
                                            {item.comment}
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant='secondary' onClick={handleClose}>
                        Закрыть
                    </Button>
                </Modal.Footer>
            </Modal>
        </>
    );
};

export default MikrotikAddressesModal;
