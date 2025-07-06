import { useState } from 'react';
import DOMPurify from 'dompurify';

import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';

const DisplayOriginalModal = (props) => {
    const [showHtmlDesc, setShowHtmlDesc] = useState(false);

    const handleShowHtmlDesc = () => {
        setShowHtmlDesc(true);
    };

    const handleCloseHtmlDesc = () => {
        setShowHtmlDesc(false);
    };

    const createMarkup = (html) => {
        return {
            __html: DOMPurify.sanitize(html),
        };
    };

    return (
        <>
            {props.ticket.htmlDescription && (
                <>
                    <Row className='mb-3'>
                        <Col sm='auto'>
                            <Button
                                className='mb-2 w-100'
                                variant='primary'
                                onClick={handleShowHtmlDesc}
                            >
                                Просмотр оригинала
                            </Button>
                        </Col>
                    </Row>
                    <Modal
                        centered
                        size='xl'
                        show={showHtmlDesc}
                        onHide={handleCloseHtmlDesc}
                    >
                        <Modal.Header closeButton>
                            <Modal.Title>Оригинал</Modal.Title>
                        </Modal.Header>
                        <Modal.Body>
                            <div
                                dangerouslySetInnerHTML={createMarkup(
                                    props.ticket.htmlDescription
                                )}
                            />
                        </Modal.Body>
                        <Modal.Footer>
                            <Button
                                variant='secondary'
                                onClick={handleCloseHtmlDesc}
                            >
                                Закрыть
                            </Button>
                        </Modal.Footer>
                    </Modal>{' '}
                </>
            )}
        </>
    );
};

export default DisplayOriginalModal;
